import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { type AppConfig } from "../../shared/infra/config/app-config";
import { InjectConfig } from "../../shared/infra/config/config.module";
import { CLOCK, type Clock } from "../../shared/domain/clock";
import { delay, withDeadline } from "../../shared/infra/delay";
import { describeError } from "../../shared/infra/http/db-error";
import { LoggerService } from "../../shared/infra/logger";
import { MetricsService } from "../../shared/infra/metrics";
import { OutboxPublisher } from "./outbox-publisher";
import { OutboxRepository } from "./outbox.repository";

const STATS_INTERVAL_MS = 1000;

/**
 * Roda o publisher em todas as instâncias (ADR-009). Inicia no bootstrap do Nest, drena a cada
 * `OUTBOX_POLL_MS` quando ocioso, e no shutdown para o loop e libera os leases desta instância.
 */
@Injectable()
export class OutboxPublisherWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private running = false;
  private loopPromise: Promise<void> | undefined;
  private statsTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly publisher: OutboxPublisher,
    private readonly repository: OutboxRepository,
    @InjectConfig() private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly metrics: MetricsService,
    private readonly logger: LoggerService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.workersEnabled) {
      return;
    }
    this.running = true;
    this.loopPromise = this.runLoop();
    this.statsTimer = setInterval(() => void this.collectStats(), STATS_INTERVAL_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    if (this.statsTimer !== undefined) {
      clearInterval(this.statsTimer);
    }
    // O grace limita a espera total: uma operação de banco travada não prende o shutdown.
    await withDeadline(this.drain(), this.config.shutdownGraceMs);
  }

  private async drain(): Promise<void> {
    if (this.loopPromise !== undefined) {
      await this.loopPromise;
    }
    await this.repository.releaseLeases(this.config.instanceId);
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        const published = await this.publisher.publishOnce();
        if (published === 0) {
          await delay(this.config.outbox.pollMs);
        }
      } catch (error) {
        this.logger.error("outbox publisher loop error", { error: describeError(error) });
        await delay(this.config.outbox.pollMs);
      }
    }
  }

  private async collectStats(): Promise<void> {
    try {
      const { pending, oldestOccurredAt } = await this.repository.stats();
      this.metrics.outboxPending.set(pending);
      const lag = oldestOccurredAt === null ? 0 : (this.clock.now().getTime() - oldestOccurredAt.getTime()) / 1000;
      this.metrics.outboxLagSeconds.set(Math.max(0, lag));
    } catch {
      // coletor de métricas é best-effort; não derruba o worker
    }
  }
}
