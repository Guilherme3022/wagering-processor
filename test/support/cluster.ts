import { type Subprocess } from "bun";
import { loadConfig } from "../../src/shared/infra/config/app-config";
import { SqsClient } from "../../src/messaging/infra/sqs/sqs-client";
import { eventually } from "./async";
import { createTestDatabase, type TestDatabase } from "./database";
import { TEST_AWS_ENDPOINT, uniqueSuffix } from "./env";

export interface Infra {
  readonly db: TestDatabase;
  readonly inputQueue: string;
  readonly dlqQueue: string;
  readonly eventsQueue: string;
  readonly sqs: SqsClient;
  readonly baseEnv: Record<string, string>;
  close(): Promise<void>;
}

/** Cria DB descartável + filas únicas e devolve o ambiente comum às instâncias do cluster. */
export async function provisionInfra(): Promise<Infra> {
  const db = await createTestDatabase();
  const suffix = uniqueSuffix();
  const inputQueue = `wager-transactions-${suffix}.fifo`;
  const dlqQueue = `wager-transactions-dlq-${suffix}.fifo`;
  const eventsQueue = `wagering-events-${suffix}.fifo`;

  const baseEnv: Record<string, string> = {
    DATABASE_URL: db.databaseUrl,
    AWS_ENDPOINT_URL: TEST_AWS_ENDPOINT,
    AWS_REGION: "us-east-1",
    SQS_INPUT_QUEUE: inputQueue,
    SQS_DLQ: dlqQueue,
    SQS_EVENTS_QUEUE: eventsQueue,
    WORKERS_ENABLED: "true",
    DB_POOL_MAX: "10",
    LOCK_TIMEOUT_MS: "15000",
    SQS_VISIBILITY_TIMEOUT_S: "2",
    OUTBOX_POLL_MS: "200",
    PENDING_REFERENCE_POLL_MS: "200",
    NODE_ENV: "test",
    LOG_LEVEL: "error",
  };

  const sqs = new SqsClient(loadConfig({ ...process.env, ...baseEnv }));
  await sqs.createFifoQueue(dlqQueue, { MessageRetentionPeriod: "1209600" });
  const dlqArn = await sqs.queueArn(dlqQueue);
  await sqs.createFifoQueue(inputQueue, {
    VisibilityTimeout: "2",
    RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: "5" }),
  });
  await sqs.createFifoQueue(eventsQueue);

  return {
    db,
    inputQueue,
    dlqQueue,
    eventsQueue,
    sqs,
    baseEnv,
    async close(): Promise<void> {
      sqs.destroy();
      await db.close();
    },
  };
}

/** Enfileira uma mensagem `WagerTransactionRequested` de uma aposta na fila de entrada. */
export function enqueueBet(
  infra: Infra,
  params: { walletId: string; playerId: string; amount: string; external: string; kind?: string },
): Promise<void> {
  const body = JSON.stringify({
    messageId: crypto.randomUUID(),
    type: "WagerTransactionRequested",
    occurredAt: new Date().toISOString(),
    data: {
      providerId: "provider-a",
      externalTransactionId: params.external,
      playerId: params.playerId,
      walletId: params.walletId,
      roundId: "round-1",
      gameId: "game-1",
      kind: params.kind ?? "BET",
      money: { amount: params.amount, currency: "BRL" },
      idempotencyKey: `provider-a:${params.external}`,
    },
  });
  return infra.sqs.sendOne(infra.inputQueue, {
    id: params.external,
    body,
    groupId: params.walletId,
    deduplicationId: params.external,
  });
}

export interface Instance {
  readonly port: number;
  readonly proc: Subprocess;
  request(path: string, init?: RequestInit): Promise<Response>;
  waitReady(): Promise<void>;
  kill(signal?: NodeJS.Signals): void;
  waitExit(): Promise<number>;
}

/** Sobe uma instância da app (processo separado) numa porta, com env adicional. */
export function spawnInstance(
  infra: Infra,
  port: number,
  extraEnv: Record<string, string> = {},
): Instance {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...infra.baseEnv,
    PORT: String(port),
    INSTANCE_ID: `inst-${port}`,
    ...extraEnv,
  };
  const proc = Bun.spawn(["bun", "run", "src/main.ts"], {
    env,
    stdout: "pipe",
    stderr: "pipe",
    cwd: process.cwd(),
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    port,
    proc,
    request: (path, init) => fetch(`${baseUrl}${path}`, init),
    async waitReady(): Promise<void> {
      await eventually(
        async () => {
          const res = await fetch(`${baseUrl}/health/live`);
          if (!res.ok) {
            throw new Error(`instance ${port} not ready`);
          }
        },
        { timeoutMs: 30000, intervalMs: 200 },
      );
    },
    kill(signal: NodeJS.Signals = "SIGTERM"): void {
      proc.kill(signal);
    },
    waitExit(): Promise<number> {
      return proc.exited;
    },
  };
}
