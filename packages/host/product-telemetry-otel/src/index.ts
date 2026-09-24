/** Explicit product usage events over OTLP/HTTP; no automatic collection or Session access. */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SeverityNumber, type Logger } from '@opentelemetry/api-logs'
import { validateHeaderValue } from 'node:http'
import { JsonLogsSerializer } from '@opentelemetry/otlp-transformer'
import { createOtlpHttpExportDelegate, getSharedConfigurationFromEnvironment, httpAgentFactoryFromOptions } from '@opentelemetry/otlp-exporter-base/node-http'
import { CompressionAlgorithm, getSharedConfigurationDefaults, mergeOtlpSharedConfigurationWithDefaults, OTLPExporterBase } from '@opentelemetry/otlp-exporter-base'
import { ExportResultCode } from '@opentelemetry/core'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs'

declare module '@deepseek-ai/cordis' {
  interface Context {
    productTelemetry: ProductTelemetry
  }
}

/** Scalar values accepted by the collector's Arrow attributes map. */
export type ProductTelemetryScalar = string | number | boolean

/** Explicitly selected analytics fields; object values may contain scalars only. */
export interface ProductTelemetryRecord {
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

/** Collector routing, application identity, and bounded in-memory batch settings. */
export interface Config {
  /** Full HTTP(S) logs URL. */
  endpoint: string
  /** Collector routing header. */
  channel: string
  /** Resource service.name supplied by the application composition. */
  serviceName: string
  /** Resource service.version supplied by the application composition. */
  serviceVersion: string
  /** Omit to honor OTEL_EXPORTER_OTLP_LOGS_COMPRESSION / OTEL_EXPORTER_OTLP_COMPRESSION. */
  compression?: 'none' | 'gzip'
  /** Maximum records per export; must not exceed maxQueueSize. */
  maxExportBatchSize: number
  /** Maximum queued records; the SDK drops new records when full. */
  maxQueueSize: number
  /** Delay before exporting a partial batch. */
  scheduledDelayMillis: number
  /** Exporter HTTP deadline, including SDK transient-error retries. */
  timeoutMillis: number
  /** Processor deadline for one batch export. */
  exportTimeoutMillis: number
  /** Outer shutdown wait; pending exports may be lost after this deadline. */
  shutdownTimeoutMillis: number
}

const positiveInteger = () => z.number().step(1).min(1).max(2_147_483_647)

/** Loader validation and defaults for application compositions. */
export const Config: z<Partial<Config>, Config> = z.object({
  endpoint: z.string().default('https://dsh-otel-collector.deepseeksvc.com/v1/logs'),
  channel: z.string().min(1).default('dsh_otel_report'),
  serviceName: z.string().required(),
  serviceVersion: z.string().required(),
  compression: z.union(['none', 'gzip']),
  maxExportBatchSize: positiveInteger().default(512),
  maxQueueSize: positiveInteger().default(2048),
  scheduledDelayMillis: positiveInteger().default(30000),
  timeoutMillis: positiveInteger().default(15000),
  exportTimeoutMillis: positiveInteger().default(20000),
  shutdownTimeoutMillis: positiveInteger().default(21000),
})

/** Host analytics sender. Mounting alone sends nothing; the owning fiber drains it on unload. */
export default class ProductTelemetry extends Service {
  static Config = Config
  private readonly logger: Logger

  constructor(ctx: Context, config: Config) {
    let endpoint: URL
    try {
      endpoint = new URL(config.endpoint)
    } catch (cause) {
      throw new Error('product-telemetry-otel: endpoint must be a valid HTTP(S) URL', { cause })
    }
    try {
      validateHeaderValue('x-channel', config.channel)
    } catch (cause) {
      throw new Error('product-telemetry-otel: channel must be a valid HTTP header value', { cause })
    }
    if (!['http:', 'https:'].includes(endpoint.protocol)) {
      throw new Error('product-telemetry-otel: endpoint must use HTTP or HTTPS')
    }
    if (config.maxExportBatchSize > config.maxQueueSize) {
      throw new Error('product-telemetry-otel: maxExportBatchSize must not exceed maxQueueSize')
    }
    super(ctx, 'productTelemetry')
    const shared = mergeOtlpSharedConfigurationWithDefaults({
      timeoutMillis: config.timeoutMillis,
      ...(config.compression === undefined ? {} : {
        compression: config.compression === 'gzip' ? CompressionAlgorithm.GZIP : CompressionAlgorithm.NONE,
      }),
    }, getSharedConfigurationFromEnvironment('LOGS'), getSharedConfigurationDefaults())
    const transport = {
      ...shared,
      url: config.endpoint,
      // This collector must not inherit another endpoint's headers or TLS client identity.
      headers: () => Promise.resolve({ 'Content-Type': 'application/json', 'x-channel': config.channel }),
      agentFactory: httpAgentFactoryFromOptions({ keepAlive: true }),
    }
    const exporter = new OTLPExporterBase(createOtlpHttpExportDelegate(transport, JsonLogsSerializer))
    const provider = new LoggerProvider({
      resource: resourceFromAttributes({
        'service.name': config.serviceName,
        'service.version': config.serviceVersion,
      }),
      processors: [new BatchLogRecordProcessor({
        maxExportBatchSize: config.maxExportBatchSize,
        maxQueueSize: config.maxQueueSize,
        scheduledDelayMillis: config.scheduledDelayMillis,
        exportTimeoutMillis: config.exportTimeoutMillis,
        exporter: {
          export: (records, callback) => {
            exporter.export(records, (result) => {
              // SDK flush/shutdown can resolve after export failure; observe the actual completion.
              if (result.code !== ExportResultCode.SUCCESS) ctx.logger.warn('Product telemetry export failed', result.error)
              callback(result)
            })
          },
          forceFlush: () => exporter.forceFlush(),
          shutdown: () => exporter.shutdown(),
        },
      })],
    })
    this.logger = provider.getLogger('@deepseek-ai/dsh-host-product-telemetry-otel')
    ctx.effect(() => async () => {
      let timer!: ReturnType<typeof setTimeout>
      const deadline = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          ctx.logger.warn('Product telemetry shutdown deadline exceeded; pending events may be lost')
          resolve()
        }, config.shutdownTimeoutMillis)
      })
      try {
        await Promise.race([provider.shutdown(), deadline])
      } finally {
        clearTimeout(timer)
      }
    })
  }

  /**
   * Enqueue one selected product event without waiting for network delivery.
   * Queue admission and shutdown completion are not collector or warehouse acknowledgements.
   * @param record - caller-owned event containing only approved analytics fields.
   */
  emit(record: ProductTelemetryRecord): void {
    const severityNumber = record.severityNumber ?? SeverityNumber.INFO
    const severityText = Object.hasOwn(SeverityNumber, severityNumber)
      ? SeverityNumber[severityNumber as SeverityNumber]
      : String(severityNumber)
    this.logger.emit({
      ...record,
      observedTimestamp: Date.now(),
      severityNumber,
      severityText,
    })
  }
}
