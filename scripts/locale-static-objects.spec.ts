import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'
import { StaticLocaleObjects } from './locale-static-objects.ts'

it('resolves translated imports, aliases, property access and registration spreads without executing modules', () => {
  const directory = mkdtempSync(join(tmpdir(), 'locale-static-'))
  try {
    writeFileSync(join(directory, 'extras.ts'), `
      throw new Error('This module must never execute')
      export const en = { missing: 'English fallback' }
      const japanese = { title: '日本語', count: '{count} 件' }
      export const extra = { ja: japanese }
    `)
    writeFileSync(join(directory, 'barrel.ts'), 'export { en, extra } from \'./extras.ts\'')
    writeFileSync(join(directory, 'default.ts'), 'const dictionaries = { ja: { footer: \'日本語の末尾\' } }; export default dictionaries')
    const file = join(directory, 'locales.ts')
    writeFileSync(file, `
      import { en as fallback, extra as imported } from './barrel.ts'
      import defaults from './default.ts'
      const local = imported.ja
      export const ja = { ...fallback, ...local, ...defaults.ja, own: '翻訳' }
      const alias = { ja }
      export const registration = { en: fallback, ...alias }
      const cycle = cycle
      export const invalid = cycle
    `)
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ESNext, true)
    const expressions = new Map<string, ts.Expression>()
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) {
          expressions.set(declaration.name.text, declaration.initializer)
        }
      }
    }
    const resolver = new StaticLocaleObjects()
    const translated = resolver.properties(expressions.get('ja'), file, true)
    expect([...(translated?.keys() ?? [])]).toEqual(['title', 'count', 'footer', 'own'])
    const count = translated?.get('count')
    expect(count === undefined ? undefined : resolver.text(count)).toBe('{count} 件')
    expect([...(resolver.properties(expressions.get('registration'), file)?.keys() ?? [])]).toEqual(['en', 'ja'])
    expect(resolver.properties(expressions.get('invalid'), file)).toBeUndefined()
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
