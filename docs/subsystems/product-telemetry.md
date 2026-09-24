# Product telemetry

English | [中文](product-telemetry.zh.md)

The [product telemetry plugin](../../packages/host/product-telemetry-otel/README.md) sends explicitly selected analytics events through OTLP/HTTP. Its `productTelemetry` service owns submission only; product consumers own when an event occurs and which fields are approved. No Session data or identifiers are collected automatically.

`ProductTelemetryRecord` requires an event name, string body, and Unix-millisecond timestamp. Attributes accept scalar strings, numbers, booleans, and one-level objects of those values (`ProductTelemetryScalar`). Optional severity uses OTel severity numbers and defaults to INFO. Observation time is assigned when the record is enqueued.

Enqueue is synchronous and does not acknowledge delivery. The SDK owns batching and retry; local diagnostics report export failures. See the package README for configuration, shutdown, and loss limits.

## Record types

```ts type-equiv
/** Scalar values accepted by the collector's Arrow attributes map. */
type ProductTelemetryScalar = string | number | boolean
```

```ts type-equiv
/** Explicitly selected analytics fields; object values may contain scalars only. */
interface ProductTelemetryRecord {
  /** Product/DA-owned event name. */
  eventName: string
  /** Human-readable summary; never a prompt, response, credential, or file contents. */
  body: string
  /** Event occurrence time in Unix milliseconds. Observation time is assigned on enqueue. */
  timestamp: number
  /** Numeric OTel severity; omitted values use INFO. */
  severityNumber?: number
  /** Business fields selected by the caller; no automatic device or account identity. */
  attributes?: Record<string, ProductTelemetryScalar | Record<string, ProductTelemetryScalar>>
}
```

Source: [`packages/host/product-telemetry-otel/src/index.ts`](../../packages/host/product-telemetry-otel/src/index.ts)

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxproducttelemetry--producttelemetry"></a>

### `ctx.productTelemetry` — `ProductTelemetry`

Host analytics sender. Mounting alone sends nothing; the owning fiber drains it on unload.

```ts cordis-catalog
/**
 * Enqueue one selected product event without waiting for network delivery.
 * Queue admission and shutdown completion are not collector or warehouse acknowledgements.
 * @param record - caller-owned event containing only approved analytics fields.
 */
emit(record: ProductTelemetryRecord): void
```

Source: [`packages/host/product-telemetry-otel/src/index.ts`](../../packages/host/product-telemetry-otel/src/index.ts)
<!-- END GENERATED cordis-surface -->
