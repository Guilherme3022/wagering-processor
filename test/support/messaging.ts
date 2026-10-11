import { type MikroORM } from "@mikro-orm/postgresql";
import { loadConfig } from "../../src/shared/infra/config/app-config";
import { CorrelationService } from "../../src/shared/infra/correlation";
import { LoggerService } from "../../src/shared/infra/logger";
import { MetricsService } from "../../src/shared/infra/metrics";
import { Database } from "../../src/shared/infra/persistence/database";
import { SystemClock } from "../../src/shared/infra/system-clock";
import { OutboxPublisher } from "../../src/messaging/infra/outbox-publisher";
import { OutboxRepository } from "../../src/messaging/infra/outbox.repository";
import { SqsClient } from "../../src/messaging/infra/sqs/sqs-client";
import { TEST_AWS_ENDPOINT, TEST_DATABASE_URL } from "./env";

export interface PublisherStack {
  readonly publisher: OutboxPublisher;
  readonly repository: OutboxRepository;
  readonly sqs: SqsClient;
}

/** Monta um publisher isolado (instância própria, lease configurável) sobre o ORM do teste. */
export function publisherStack(
  orm: MikroORM,
  options: { eventsQueue: string; instanceId: string; leaseMs: number },
): PublisherStack {
  const config = loadConfig({
    ...process.env,
    DATABASE_URL: TEST_DATABASE_URL,
    AWS_ENDPOINT_URL: TEST_AWS_ENDPOINT,
    SQS_EVENTS_QUEUE: options.eventsQueue,
    OUTBOX_LEASE_MS: String(options.leaseMs),
    INSTANCE_ID: options.instanceId,
  });
  const database = new Database(orm);
  const repository = new OutboxRepository(database);
  const sqs = new SqsClient(config);
  const logger = new LoggerService(config, new CorrelationService());
  const publisher = new OutboxPublisher(repository, sqs, config, new SystemClock(), new MetricsService(), logger);
  return { publisher, repository, sqs };
}

/** Recebe todas as mensagens disponíveis numa fila (para asserções de teste). */
export async function drainQueue(sqs: SqsClient, queueName: string): Promise<string[]> {
  const bodies: string[] = [];
  let emptyPolls = 0;
  while (emptyPolls < 3) {
    const messages = await sqs.receive(queueName, { maxMessages: 10, waitSeconds: 1, visibilityTimeout: 5 });
    if (messages.length === 0) {
      emptyPolls += 1;
      continue;
    }
    emptyPolls = 0;
    for (const message of messages) {
      bodies.push(message.body);
      await sqs.deleteMessage(queueName, message.receiptHandle);
    }
  }
  return bodies;
}
