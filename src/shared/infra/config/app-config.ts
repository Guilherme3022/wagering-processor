import { hostname } from "node:os";
import { z } from "zod";

const positiveInt = z.coerce.number().int().positive();

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: positiveInt.default(3000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    INSTANCE_ID: z.string().min(1).optional(),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DB_POOL_MAX: positiveInt.default(20),
    LOCK_TIMEOUT_MS: positiveInt.default(2000),

    AWS_ENDPOINT_URL: z.url().optional(),
    AWS_REGION: z.string().min(1).default("us-east-1"),
    SQS_INPUT_QUEUE: z.string().endsWith(".fifo").default("wager-transactions.fifo"),
    SQS_DLQ: z.string().endsWith(".fifo").default("wager-transactions-dlq.fifo"),
    SQS_EVENTS_QUEUE: z.string().endsWith(".fifo").default("wagering-events.fifo"),
    SQS_CONSUMER_CONCURRENCY: positiveInt.default(10),
    SQS_VISIBILITY_TIMEOUT_S: positiveInt.default(60),
    SQS_MAX_RECEIVE_COUNT: positiveInt.default(5),

    OUTBOX_POLL_MS: positiveInt.default(500),
    OUTBOX_BATCH: positiveInt.default(50),
    OUTBOX_LEASE_MS: positiveInt.default(30_000),

    PENDING_REFERENCE_POLL_MS: positiveInt.default(1000),
    PENDING_REFERENCE_TTL_MS: positiveInt.default(86_400_000),
    PENDING_REFERENCE_MAX_BACKOFF_MS: positiveInt.default(300_000),

    SHUTDOWN_GRACE_MS: positiveInt.default(25_000),
    FAULT_INJECTION: z.enum(["exit_after_commit_before_ack", "fail_transient"]).optional(),
    WORKERS_ENABLED: z.enum(["true", "false"]).default("true"),
    AUTH_ENABLED: z.enum(["true", "false"]).default("false"),
    AUTH_JWKS_URI: z.url().optional(),
    AUTH_ISSUER: z.string().min(1).optional(),
    AUTH_AUDIENCE: z.string().min(1).optional(),
  })
  .refine((env) => env.AUTH_ENABLED === "false" || (env.AUTH_JWKS_URI !== undefined && env.AUTH_ISSUER !== undefined), {
    message: "AUTH_ENABLED=true exige AUTH_JWKS_URI e AUTH_ISSUER",
    path: ["AUTH_ENABLED"],
  })
  .refine((env) => env.FAULT_INJECTION === undefined || env.NODE_ENV === "test", {
    message: "FAULT_INJECTION só pode ser usado com NODE_ENV=test",
    path: ["FAULT_INJECTION"],
  });

export type AppConfig = ReturnType<typeof toAppConfig>;

export class InvalidConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Configuração inválida:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "InvalidConfigError";
  }
}

/** Lê e valida as variáveis de ambiente da spec §11. Falha rápido com todos os problemas de uma vez. */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new InvalidConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  return toAppConfig(parsed.data);
}

function toAppConfig(env: z.infer<typeof schema>) {
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    instanceId: env.INSTANCE_ID ?? `${hostname()}-${process.pid}`,
    database: {
      url: env.DATABASE_URL,
      poolMax: env.DB_POOL_MAX,
      lockTimeoutMs: env.LOCK_TIMEOUT_MS,
    },
    sqs: {
      endpointUrl: env.AWS_ENDPOINT_URL,
      region: env.AWS_REGION,
      inputQueue: env.SQS_INPUT_QUEUE,
      deadLetterQueue: env.SQS_DLQ,
      eventsQueue: env.SQS_EVENTS_QUEUE,
      consumerConcurrency: env.SQS_CONSUMER_CONCURRENCY,
      visibilityTimeoutSeconds: env.SQS_VISIBILITY_TIMEOUT_S,
      maxReceiveCount: env.SQS_MAX_RECEIVE_COUNT,
    },
    outbox: {
      pollMs: env.OUTBOX_POLL_MS,
      batchSize: env.OUTBOX_BATCH,
      leaseMs: env.OUTBOX_LEASE_MS,
    },
    pendingReference: {
      pollMs: env.PENDING_REFERENCE_POLL_MS,
      ttlMs: env.PENDING_REFERENCE_TTL_MS,
      maxBackoffMs: env.PENDING_REFERENCE_MAX_BACKOFF_MS,
    },
    shutdownGraceMs: env.SHUTDOWN_GRACE_MS,
    faultInjection: env.FAULT_INJECTION,
    workersEnabled: env.WORKERS_ENABLED === "true",
    auth: {
      enabled: env.AUTH_ENABLED === "true",
      jwksUri: env.AUTH_JWKS_URI,
      issuer: env.AUTH_ISSUER,
      audience: env.AUTH_AUDIENCE,
    },
  } as const;
}
