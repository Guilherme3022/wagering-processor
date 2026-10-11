import { Inject, Injectable } from "@nestjs/common";
import { type AppConfig } from "../../shared/infra/config/app-config";
import { InjectConfig } from "../../shared/infra/config/config.module";
import { CLOCK, type Clock } from "../../shared/domain/clock";
import { exponentialBackoffMs } from "../../shared/domain/backoff";
import { LoggerService } from "../../shared/infra/logger";
import { MetricsService } from "../../shared/infra/metrics";
import { OutboxRepository } from "./outbox.repository";
import { SqsClient } from "./sqs/sqs-client";

const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60_000;

/**
 * Publica a outbox (ADR-009): reivindica um lote com lease, envia ao SQS **fora** de qualquer
 * transação e marca `published_at` condicionado ao próprio `locked_by`. Falha agenda retry e
 * libera o lease. Sem limite de tentativas: evento confirmado nunca é descartado.
 */
@Injectable()
export class OutboxPublisher {
  constructor(
    private readonly repository: OutboxRepository,
    private readonly sqs: SqsClient,
    @InjectConfig() private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly metrics: MetricsService,
    private readonly logger: LoggerService,
  ) {}

  /** Um ciclo: claim → publica → marca/retry. Devolve quantos foram publicados. */
  async publishOnce(): Promise<number> {
    const now = this.clock.now();
    const leaseUntil = new Date(now.getTime() + this.config.outbox.leaseMs);
    const records = await this.repository.claim(
      this.config.instanceId,
      now,
      leaseUntil,
      this.config.outbox.batchSize,
    );
    if (records.length === 0) {
      return 0;
    }

    const messages = records.map((record) => ({
      id: record.id,
      body: record.payload,
      groupId: record.aggregateId,
      deduplicationId: record.id,
    }));

    let succeeded: Set<string>;
    try {
      succeeded = await this.sqs.sendBatch(this.config.sqs.eventsQueue, messages);
    } catch (error) {
      await this.retryAll(records, error instanceof Error ? error.message : String(error));
      this.metrics.outboxPublishFailures.inc(records.length);
      this.logger.warn("outbox batch publish failed", { count: records.length });
      return 0;
    }

    let published = 0;
    for (const record of records) {
      if (succeeded.has(record.id)) {
        await this.repository.markPublished(record.id, this.config.instanceId, this.clock.now());
        published += 1;
      } else {
        await this.repository.scheduleRetry(
          record.id,
          this.config.instanceId,
          this.nextAttemptAt(record.attempts),
          "batch entry failed",
        );
        this.metrics.outboxPublishFailures.inc();
      }
    }
    return published;
  }

  private async retryAll(
    records: ReadonlyArray<{ id: string; attempts: number }>,
    error: string,
  ): Promise<void> {
    for (const record of records) {
      await this.repository.scheduleRetry(
        record.id,
        this.config.instanceId,
        this.nextAttemptAt(record.attempts),
        error,
      );
    }
  }

  private nextAttemptAt(attempts: number): Date {
    const delay = exponentialBackoffMs({
      attempts: attempts + 1,
      baseMs: BASE_BACKOFF_MS,
      maxMs: MAX_BACKOFF_MS,
      jitterRatio: 0.2,
    });
    return new Date(this.clock.now().getTime() + delay);
  }
}
