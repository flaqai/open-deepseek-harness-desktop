/** Static object resolution for locale checks; package modules are parsed, never executed. */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'

/** A property expression together with its declaring module. */
export interface StaticLocaleProperty {
  expression: ts.Expression
  file: string
}

/** Resolve locale object declarations, relative imports, and object spreads without running source code. */
export class StaticLocaleObjects {
  private readonly modules = new Map<string, ts.SourceFile>()

  /** Parse and cache a source module. @param file Absolute module path. @returns Parsed source. */
  private source(file: string): ts.SourceFile {
    let source = this.modules.get(file)
    if (source === undefined) {
      source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ESNext, true)
      this.modules.set(file, source)
    }
    return source
  }

  /** Resolve one static object. English fallback spreads are excluded when checking translated coverage.
   * @param expression Object expression or reference.
   * @param file Declaring module.
   * @param translated Whether English fallback spreads must be ignored.
   * @param trail Current resolution chain, preventing import and initializer cycles.
   * @returns Resolved properties, or undefined for a dynamic expression.
   */
  properties(
    expression: ts.Expression | undefined,
    file: string,
    translated = false,
    trail: ReadonlySet<string> = new Set(),
  ): Map<string, StaticLocaleProperty> | undefined {
    const node = unwrap(expression)
    if (node === undefined) return undefined
    const identity = `${file}:${node.pos}:${node.end}`
    if (trail.has(identity)) return undefined
    const next = new Set(trail).add(identity)
    if (ts.isIdentifier(node)) {
      const binding = this.binding(node.text, file)
      return binding === undefined ? undefined : this.properties(binding.expression, binding.file, translated, next)
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const key = ts.isPropertyAccessExpression(node) ? node.name.text
        : ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : undefined
      const owner = this.properties(node.expression, file, false, next)
      const value = key === undefined ? undefined : owner?.get(key)
      return value === undefined ? undefined : this.properties(value.expression, value.file, translated, next)
    }
    if (!ts.isObjectLiteralExpression(node)) return undefined
    const result = new Map<string, StaticLocaleProperty>()
    for (const prop of node.properties) {
      if (ts.isSpreadAssignment(prop)) {
        if (translated && this.englishReference(prop.expression, file)) continue
        for (const [key, value] of this.properties(prop.expression, file, translated, next) ?? []) result.set(key, value)
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        result.set(prop.name.text, { expression: prop.name, file })
      } else if (ts.isPropertyAssignment(prop) && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) {
        result.set(prop.name.text, { expression: prop.initializer, file })
      }
    }
    return result
  }

  /** Read a literal template through local or imported constant aliases.
   * @param property Resolved property.
   * @param trail Visited aliases.
   * @returns Literal text, or undefined for computed values.
   */
  text(property: StaticLocaleProperty, trail: ReadonlySet<string> = new Set()): string | undefined {
    const node = unwrap(property.expression)
    if (node === undefined) return undefined
    if (ts.isStringLiteralLike(node)) return node.text
    if (ts.isPropertyAccessExpression(node)) {
      const value = this.properties(node.expression, property.file)?.get(node.name.text)
      return value === undefined ? undefined : this.text(value, trail)
    }
    if (!ts.isIdentifier(node)) return undefined
    const identity = `${property.file}:${node.text}`
    if (trail.has(identity)) return undefined
    const binding = this.binding(node.text, property.file)
    return binding === undefined ? undefined : this.text(binding, new Set(trail).add(identity))
  }

  private binding(name: string, file: string): StaticLocaleProperty | undefined {
    const source = this.source(file)
    let result: StaticLocaleProperty | undefined
    const collect = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer !== undefined) {
        result = { expression: node.initializer, file }
      }
      ts.forEachChild(node, collect)
    }
    collect(source)
    if (result !== undefined) return result
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
        || !statement.moduleSpecifier.text.startsWith('.')) continue
      const bindings = statement.importClause?.namedBindings
      const imported = bindings !== undefined && ts.isNamedImports(bindings)
        ? bindings.elements.find(specifier => specifier.name.text === name) : undefined
      const isDefault = statement.importClause?.name?.text === name
      if (imported === undefined && !isDefault) continue
      const target = resolve(dirname(file), statement.moduleSpecifier.text)
      const candidate = [target, target.replace(/\.js$/u, '.ts'), `${target}.ts`].find(existsSync)
      if (candidate === undefined) return undefined
      if (isDefault) {
        const exported = this.source(candidate).statements.find(ts.isExportAssignment)
        return exported === undefined ? undefined : { expression: exported.expression, file: candidate }
      }
      return this.binding(imported?.propertyName?.text ?? imported?.name.text ?? '', candidate)
    }
    for (const statement of source.statements) {
      if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier === undefined
        || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.startsWith('.')
        || statement.exportClause === undefined || !ts.isNamedExports(statement.exportClause)) continue
      const exported = statement.exportClause.elements.find(entry => entry.name.text === name)
      if (exported === undefined) continue
      const target = resolve(dirname(file), statement.moduleSpecifier.text)
      return existsSync(target) ? this.binding(exported.propertyName?.text ?? exported.name.text, target) : undefined
    }
    return undefined
  }

  private englishReference(expression: ts.Expression, file: string, trail: ReadonlySet<string> = new Set()): boolean {
    const node = unwrap(expression)
    if (node === undefined) return false
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'en') return true
    if (!ts.isIdentifier(node)) return false
    if (/^(?:en|en[A-Z].*|.*En)$/u.test(node.text)) return true
    const identity = `${file}:${node.text}`
    if (trail.has(identity)) return false
    const source = this.source(file)
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement)) continue
      const bindings = statement.importClause?.namedBindings
      if (bindings !== undefined && ts.isNamedImports(bindings)
        && bindings.elements.some(entry => entry.name.text === node.text && entry.propertyName?.text === 'en')) return true
    }
    const binding = this.binding(node.text, file)
    return binding !== undefined && this.englishReference(binding.expression, binding.file, new Set(trail).add(identity))
  }
}

function unwrap(expression: ts.Expression | undefined): ts.Expression | undefined {
  let node = expression
  while (node !== undefined && (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node))) {
    node = node.expression
  }
  return node
}
