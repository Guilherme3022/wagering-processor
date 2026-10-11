import { type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../src/app.module";
import { loadConfig } from "../../src/shared/infra/config/app-config";
import { SqsClient } from "../../src/messaging/infra/sqs/sqs-client";
import { createTestDatabase, type TestDatabase } from "./database";
import { TEST_AWS_ENDPOINT, uniqueSuffix } from "./env";

export interface MessageData {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: "BET" | "WIN" | "LOSS" | "REFUND" | "ROLLBACK";
  money: { amount: string; currency: string };
  idempotencyKey: string;
  referenceExternalTransactionId?: string;
}

export interface MessagingApp {
  readonly db: TestDatabase;
  readonly baseUrl: string;
  readonly inputQueue: string;
  readonly dlqQueue: string;
  readonly eventsQueue: string;
  readonly sqs: SqsClient;
  request(path: string, init?: RequestInit): Promise<Response>;
  /** Enfileira uma mensagem `WagerTransactionRequested`. `dedup` distingue reenvios físicos. */
  send(messageId: string, data: MessageData, dedup?: string): Promise<void>;
  close(): Promise<void>;
}

/** Sobe a app com workers ligados (outbox, referência, consumer) e filas únicas por teste. */
export async function startMessagingApp(
  overrides: Record<string, string> = {},
): Promise<MessagingApp> {
  const db = await createTestDatabase();
  const suffix = uniqueSuffix();
  const inputQueue = `wager-transactions-${suffix}.fifo`;
  const dlqQueue = `wager-transactions-dlq-${suffix}.fifo`;
  const eventsQueue = `wagering-events-${suffix}.fifo`;

  Object.assign(process.env, {
    DATABASE_URL: db.databaseUrl,
    AWS_ENDPOINT_URL: TEST_AWS_ENDPOINT,
    SQS_INPUT_QUEUE: inputQueue,
    SQS_DLQ: dlqQueue,
    SQS_EVENTS_QUEUE: eventsQueue,
    WORKERS_ENABLED: "true",
    SQS_VISIBILITY_TIMEOUT_S: "2",
    OUTBOX_POLL_MS: "200",
    PENDING_REFERENCE_POLL_MS: "200",
    ...overrides,
  });

  const config = loadConfig(process.env);
  const sqs = new SqsClient(config);
  await sqs.createFifoQueue(dlqQueue, { MessageRetentionPeriod: "1209600" });
  const dlqArn = await sqs.queueArn(dlqQueue);
  await sqs.createFifoQueue(inputQueue, {
    VisibilityTimeout: "2",
    RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: config.sqs.maxReceiveCount }),
  });
  await sqs.createFifoQueue(eventsQueue);

  const app: INestApplication = await NestFactory.create(AppModule, { logger: false });
  app.enableShutdownHooks();
  await app.listen(0);
  const baseUrl = (await app.getUrl()).replace("[::1]", "127.0.0.1").replace("://::1", "://127.0.0.1");

  return {
    db,
    baseUrl,
    inputQueue,
    dlqQueue,
    eventsQueue,
    sqs,
    request: (path, init) => fetch(`${baseUrl}${path}`, init),
    async send(messageId, data, dedup): Promise<void> {
      const body = JSON.stringify({ messageId, type: "WagerTransactionRequested", occurredAt: new Date().toISOString(), data });
      await sqs.sendOne(inputQueue, { id: messageId, body, groupId: data.walletId, deduplicationId: dedup ?? messageId });
    },
    async close(): Promise<void> {
      await app.close();
      sqs.destroy();
      await db.close();
    },
  };
}
