import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import {
  balanceChangedEvent,
  processedEvent,
  rejectedEvent,
} from "../../shared/application/event-factory";
import {
  type PersistencePorts,
  UNIT_OF_WORK,
  type UnitOfWork,
} from "../../shared/application/persistence";
import { exponentialBackoffMs } from "../../shared/domain/backoff";
import { CLOCK, type Clock } from "../../shared/domain/clock";
import { FailureCode } from "../../shared/domain/failure-code";
import { ID_GENERATOR, type IdGenerator } from "../../shared/domain/id-generator";
import { type AppConfig } from "../../shared/infra/config/app-config";
import { InjectConfig } from "../../shared/infra/config/config.module";
import { CorrelationService } from "../../shared/infra/correlation";
import { delay, withDeadline } from "../../shared/infra/delay";
import { describeError } from "../../shared/infra/http/db-error";
import { LoggerService } from "../../shared/infra/logger";
import { MetricsService } from "../../shared/infra/metrics";
import { Wallet } from "../../wallet/domain/wallet";
import { resolveReference } from "../domain/reference-policy";
import { WagerKind } from "../domain/wager-kind";
import { WagerStatus } from "../domain/wager-status";
import { type WagerTransaction } from "../domain/wager-transaction";
import { applyEffect } from "../application/wager-effect";

const STATS_INTERVAL_MS = 1000;

/**
 * Reprocessa transações em `PENDING_REFERENCE` (ADR-004). Reivindica as vencidas com
 * `SKIP LOCKED`, trava a wallet antes da transação e re-tenta a resolução com o mesmo serviço de
 * domínio. Backoff com teto; ao vencer o prazo faz uma última tentativa e então rejeita com
 * `REFERENCE_NOT_FOUND`.
 */
@Injectable()
export class ReprocessPendingReference implements OnApplicationBootstrap, OnApplicationShutdown {
  private running = false;
  private loopPromise: Promise<void> | undefined;
  private statsTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
    @InjectConfig() private readonly config: AppConfig,
    private readonly metrics: MetricsService,
    private readonly logger: LoggerService,
    private readonly correlation: CorrelationService,
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
    // O grace limita a espera total (consistente com os demais workers).
    await withDeadline(this.loopPromise ?? Promise.resolve(), this.config.shutdownGraceMs);
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        const processed = await this.tick();
        if (processed === 0) {
          await delay(this.config.pendingReference.pollMs);
        }
      } catch (error) {
        this.logger.error("pending reference worker error", { error: describeError(error) });
        await delay(this.config.pendingReference.pollMs);
      }
    }
  }

  /** Um ciclo: reivindica candidatos e processa cada um numa transação própria. */
  async tick(): Promise<number> {
    const ids = await this.uow.transaction((ports) =>
      ports.transactions.claimPendingReferenceDue(this.clock.now(), 50),
    );
    for (const id of ids) {
      await this.process(id);
    }
    return ids.length;
  }

  private process(id: string): Promise<void> {
    return this.correlation.run({ correlationId: id, messageId: id, instanceId: this.config.instanceId }, () =>
      this.processLocked(id),
    );
  }

  private async processLocked(id: string): Promise<void> {
    await this.uow.transaction(async (ports) => {
      const preview = await ports.transactions.findById(id);
      if (preview === null || preview.status !== WagerStatus.PendingReference || preview.walletId === null) {
        return;
      }
      const walletSnapshot = await ports.wallets.lockById(preview.walletId);
      const tx = await ports.transactions.lockById(id);
      if (walletSnapshot === null || tx === null || tx.status !== WagerStatus.PendingReference) {
        return;
      }
      this.correlation.set({
        transactionId: tx.id,
        providerId: tx.providerId,
        ...(tx.walletId !== null ? { walletId: tx.walletId } : {}),
      });

      const now = this.clock.now();
      const reference = await ports.transactions.findByProviderExternal(
        tx.providerId,
        tx.referenceExternalTransactionId ?? "",
      );
      const isCompensation = tx.kind === WagerKind.Refund || tx.kind === WagerKind.Rollback;
      const alreadyCompensated =
        reference !== null && reference.status === WagerStatus.Processed && isCompensation
          ? await ports.transactions.hasProcessedCompensation(reference.id)
          : false;

      const resolution = resolveReference({
        kind: tx.kind,
        money: tx.money,
        playerId: tx.playerId,
        walletId: preview.walletId,
        roundId: tx.roundId,
        reference,
        alreadyCompensated,
      });

      if (resolution.type === "pending") {
        await this.handleStillPending(ports, tx, walletSnapshot.balance, now);
        return;
      }
      if (resolution.type === "rejected") {
        await this.reject(ports, tx, resolution.failureCode, walletSnapshot.balance, now);
        return;
      }

      const wallet = Wallet.rehydrate(walletSnapshot);
      const effect = applyEffect({
        wallet,
        kind: tx.kind,
        money: tx.money,
        direction: resolution.direction,
        entryId: this.ids.next(),
        txId: tx.id,
        at: now,
        referenceId: resolution.reference.id,
      });
      if (effect.type === "rejected") {
        await this.reject(ports, tx, effect.failureCode, effect.balance, now, resolution.reference.id);
        return;
      }

      tx.markProcessed({ walletId: wallet.id, resultBalance: effect.balance, referenceTransactionId: effect.referenceId, at: now });
      await ports.transactions.update(tx);
      this.metrics.wagerTransactions.inc({ status: "PROCESSED", kind: tx.kind, source: "reference_worker" });
      if (effect.entry !== null) {
        await ports.wallets.updateBalance({
          id: wallet.id,
          newBalance: wallet.balance,
          expectedVersion: walletSnapshot.version,
          newVersion: wallet.version,
          at: now,
        });
        await ports.ledger.insert(effect.entry);
        await ports.outbox.enqueue(
          balanceChangedEvent({ entry: effect.entry, eventId: this.ids.next(), causationId: tx.id, correlationId: tx.correlationId }),
          now,
        );
      }
      await ports.outbox.enqueue(processedEvent({ tx, eventId: this.ids.next(), causationId: tx.id }), now);
      await ports.transactions.rescheduleDependents(tx.providerId, tx.externalTransactionId, now);
    });
  }

  private async handleStillPending(
    ports: PersistencePorts,
    tx: WagerTransaction,
    balance: Wallet["balance"],
    now: Date,
  ): Promise<void> {
    const deadline = tx.referenceDeadlineAt;
    if (deadline !== null && now.getTime() >= deadline.getTime()) {
      await this.reject(ports, tx, FailureCode.ReferenceNotFound, balance, now);
      return;
    }
    const backoff = exponentialBackoffMs({
      attempts: tx.referenceAttempts + 1,
      baseMs: 1000,
      maxMs: this.config.pendingReference.maxBackoffMs,
      jitterRatio: 0.2,
    });
    tx.markPendingReference({
      nextReferenceAttemptAt: new Date(now.getTime() + backoff),
      referenceDeadlineAt: deadline ?? new Date(now.getTime() + this.config.pendingReference.ttlMs),
    });
    await ports.transactions.update(tx);
  }

  private async reject(
    ports: PersistencePorts,
    tx: WagerTransaction,
    failureCode: FailureCode,
    balance: Wallet["balance"],
    now: Date,
    referenceId: string | null = null,
  ): Promise<void> {
    tx.reject({ failureCode, walletId: tx.walletId, resultBalance: balance, referenceTransactionId: referenceId });
    await ports.transactions.update(tx);
    this.metrics.wagerTransactions.inc({ status: "REJECTED", kind: tx.kind, source: "reference_worker" });
    await ports.outbox.enqueue(
      rejectedEvent({ tx, eventId: this.ids.next(), causationId: tx.id, rejectedAt: now }),
      now,
    );
  }

  private async collectStats(): Promise<void> {
    try {
      const pending = await this.uow.transaction((ports) => ports.transactions.countPendingReference());
      this.metrics.pendingReference.set(pending);
    } catch {
      // best-effort
    }
  }
}
