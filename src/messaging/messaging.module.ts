import { Global, Module } from "@nestjs/common";
import { OutboxPublisher } from "./infra/outbox-publisher";
import { OutboxPublisherWorker } from "./infra/outbox-publisher.worker";
import { OutboxRepository } from "./infra/outbox.repository";
import { SqsClient } from "./infra/sqs/sqs-client";

/** Contexto `messaging` (spec §2.1): cliente SQS, publicação da outbox e (M8) consumidor. */
@Global()
@Module({
  providers: [SqsClient, OutboxRepository, OutboxPublisher, OutboxPublisherWorker],
  exports: [SqsClient, OutboxRepository, OutboxPublisher],
})
export class MessagingModule {}
