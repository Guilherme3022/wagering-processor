import { Inject, Injectable } from "@nestjs/common";
import {
  balanceChangedEvent,
  pendingReferenceEvent,
  processedEvent,
  rejectedEvent,
} from "../../shared/application/event-factory";
import { ConcurrentWriteError } from "../../shared/application/concurrent-write-error";
import {
  type PersistencePorts,
  UNIT_OF_WORK,
  type UnitOfWork,
} from "../../shared/application/persistence";
import { PENDING_REFERENCE_TTL_MS } from "../../shared/application/settings";
import { CLOCK, type Clock } from "../../shared/domain/clock";
import { type FailureCode, FailureCode as Codes } from "../../shared/domain/failure-code";
import { ID_GENERATOR, type IdGenerator } from "../../shared/domain/id-generator";
import { InvariantViolationError } from "../../shared/domain/domain-error";
import { Money, type MoneyProps } from "../../shared/domain/money";
import { InboxPayloadConflictError } from "../../messaging/domain/inbox-errors";
import { Wallet, type WalletSnapshot } from "../../wallet/domain/wallet";
import {
  DuplicateExternalTransactionError,
  IdempotencyKeyConflictError,
} from "../domain/idempotency-errors";
import { PayloadHasher } from "../domain/payload-hasher";
import { needsReference, resolveReference } from "../domain/reference-policy";
import { WagerKind } from "../domain/wager-kind";
import { WagerStatus } from "../domain/wager-status";
import { WagerTransaction } from "../domain/wager-transaction";
import { applyEffect, type EffectOutcome } from "./wager-effect";

export type SubmissionSource = { type: "http" } | { type: "sqs"; messageId: string; consumerName: string };

export interface SubmitCommand {
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly playerId: string;
  readonly walletId: string;
  readonly roundId: string | null;
  readonly gameId: string | null;
  readonly kind: WagerKind;
  readonly money: MoneyProps;
  readonly referenceExternalTransactionId: string | null;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly source: SubmissionSource;
}

export interface SubmitResult {
  readonly transactionId: string;
  readonly status: WagerStatus;
  readonly balance: MoneyProps | null;
  readonly failureCode: FailureCode | null;
  readonly idempotentReplay: boolean;
  /** Mensagem SQS já estava na inbox: o consumidor confirma sem efeito (spec §6.6). */
  readonly inboxDuplicate: boolean;
  /** Conflito de idempotência/duplicidade resolvido no SQS (inbox gravada; o consumidor ack). */
  readonly conflict: boolean;
}

type Outcome = EffectOutcome | { readonly type: "pending" };

/**
 * Processa uma operação de aposta (spec §6.1). Mesmo use case para HTTP e SQS. Fluxo: lock da
 * wallet → idempotência → resolve referência (§3.4) → aplica efeito no agregado → grava
 * transação, saldo, ledger e eventos na mesma transação SQL. Wallet inexistente é rejeição
 * persistida (ADR-002); referência ausente vira `PENDING_REFERENCE` (ADR-004).
 */
@Injectable()
export class SubmitWagerTransaction {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PENDING_REFERENCE_TTL_MS) private readonly pendingReferenceTtlMs: number,
    private readonly hasher: PayloadHasher,
  ) {}

  async execute(command: SubmitCommand): Promise<SubmitResult> {
    const money = Money.from(command.money);
    const payloadHash = this.hashOf(command);
    try {
      return await this.runInTransaction(command, payloadHash, (ports) =>
        this.process(ports, command, money, payloadHash),
      );
    } catch (error) {
      // Corrida: a chave foi inserida por outra transação entre a nossa leitura e o INSERT. O
      // rollback desfez tudo (inclusive a inbox); resolvemos numa NOVA transação, que regrava a
      // inbox e devolve replay/conflito antes do ack (spec §6.1).
      if (error instanceof ConcurrentWriteError) {
        return this.runInTransaction(command, payloadHash, (ports) =>
          this.resolveExisting(ports, command, payloadHash),
        );
      }
      throw error;
    }
  }

  /**
   * Abre a transação, entra na inbox (SQS) e roda `core`. Conflito de negócio no SQS não dá
   * rollback: grava a inbox e vira resultado terminal (o consumidor ack). No HTTP, propaga (409).
   */
  private runInTransaction(
    command: SubmitCommand,
    payloadHash: string,
    core: (ports: PersistencePorts) => Promise<SubmitResult>,
  ): Promise<SubmitResult> {
    return this.uow.transaction(async (ports) => {
      const source = command.source;
      if (source.type === "sqs") {
        const state = await ports.inbox.register(source.consumerName, source.messageId, payloadHash, this.clock.now());
        if (state === "conflict") {
          throw new InboxPayloadConflictError(source.messageId);
        }
        if (state === "duplicate") {
          return INBOX_DUPLICATE;
        }
      }
      try {
        const result = await core(ports);
        if (source.type === "sqs") {
          await ports.inbox.markProcessed(source.consumerName, source.messageId, this.clock.now());
        }
        return result;
      } catch (error) {
        if (source.type === "sqs" && isConflictError(error)) {
          await ports.inbox.markProcessed(source.consumerName, source.messageId, this.clock.now());
          return conflictResult(error);
        }
        throw error;
      }
    });
  }

  private async process(
    ports: PersistencePorts,
    command: SubmitCommand,
    money: Money,
    payloadHash: string,
  ): Promise<SubmitResult> {
    const wallet = await ports.wallets.lockById(command.walletId);
    return wallet === null
      ? this.handleWalletNotFound(ports, command, money, payloadHash)
      : this.handleWithWallet(ports, command, money, payloadHash, wallet);
  }

  /** Resolução após `ConcurrentWriteError`: a linha já existe → replay (hash igual) ou conflito. */
  private async resolveExisting(
    ports: PersistencePorts,
    command: SubmitCommand,
    payloadHash: string,
  ): Promise<SubmitResult> {
    const replay = await this.tryReplay(ports, command, payloadHash);
    if (replay !== null) {
      return replay;
    }
    await this.assertNoExternalConflict(ports, command);
    // Não achou por key nem por (provider, external) após um 23505 de idempotência: trata como
    // conflito de key (defensivo — não deveria ocorrer).
    throw new IdempotencyKeyConflictError();
  }

  private hashOf(command: SubmitCommand): string {
    return this.hasher.hash({
      providerId: command.providerId,
      externalTransactionId: command.externalTransactionId,
      playerId: command.playerId,
      walletId: command.walletId,
      roundId: command.roundId,
      gameId: command.gameId,
      kind: command.kind,
      money: command.money,
      referenceExternalTransactionId: command.referenceExternalTransactionId,
    });
  }

  /** Caminho ADR-002: sem wallet não há linha para travar; serializa por `ON CONFLICT`. */
  private async handleWalletNotFound(
    ports: PersistencePorts,
    command: SubmitCommand,
    money: Money,
    payloadHash: string,
  ): Promise<SubmitResult> {
    // Resolve replay/duplicidade antes de inserir (mesma ordem da §5.3), para um reenvio com outra
    // key cair em DUPLICATE_EXTERNAL_TRANSACTION (negócio) e não escapar como 23505.
    const replay = await this.tryReplay(ports, command, payloadHash);
    if (replay !== null) {
      return replay;
    }
    await this.assertNoExternalConflict(ports, command);

    const at = this.clock.now();
    const tx = this.createTransaction(command, money, payloadHash, null, at);
    tx.reject({ failureCode: Codes.WalletNotFound, walletId: null, resultBalance: null, referenceTransactionId: null });
    const inserted = await ports.transactions.insertIfAbsent(tx);
    if (!inserted) {
      const concurrentReplay = await this.tryReplay(ports, command, payloadHash);
      if (concurrentReplay === null) {
        throw new InvariantViolationError("expected an existing transaction to replay");
      }
      return concurrentReplay;
    }
    await ports.outbox.enqueue(
      rejectedEvent({ tx, eventId: this.ids.next(), causationId: command.causationId, rejectedAt: at }),
      at,
    );
    return buildResult(tx, false);
  }

  private async handleWithWallet(
    ports: PersistencePorts,
    command: SubmitCommand,
    money: Money,
    payloadHash: string,
    snapshot: WalletSnapshot,
  ): Promise<SubmitResult> {
    const replay = await this.tryReplay(ports, command, payloadHash);
    if (replay !== null) {
      return replay;
    }
    await this.assertNoExternalConflict(ports, command);

    const at = this.clock.now();
    const wallet = Wallet.rehydrate(snapshot);
    const tx = this.createTransaction(command, money, payloadHash, wallet.id, at);
    const outcome = await this.resolveOutcome(ports, command, money, wallet, tx.id, at);

    if (outcome.type === "pending") {
      tx.markPendingReference({
        nextReferenceAttemptAt: at,
        referenceDeadlineAt: new Date(at.getTime() + this.pendingReferenceTtlMs),
      });
      await ports.transactions.insert(tx);
      await ports.outbox.enqueue(
        pendingReferenceEvent({ tx, eventId: this.ids.next(), causationId: command.causationId }),
        at,
      );
      return buildResult(tx, false);
    }
    if (outcome.type === "rejected") {
      tx.reject({ failureCode: outcome.failureCode, walletId: wallet.id, resultBalance: outcome.balance, referenceTransactionId: null });
      await ports.transactions.insert(tx);
      await ports.outbox.enqueue(
        rejectedEvent({ tx, eventId: this.ids.next(), causationId: command.causationId, rejectedAt: at }),
        at,
      );
      return buildResult(tx, false);
    }

    tx.markProcessed({ walletId: wallet.id, resultBalance: outcome.balance, referenceTransactionId: outcome.referenceId, at });
    await ports.transactions.insert(tx);
    await this.persistProcessedSideEffects(ports, command, tx, wallet, snapshot, outcome, at);
    return buildResult(tx, false);
  }

  /** Grava saldo/ledger/eventos de uma transação processada e reagenda dependentes (spec §6.4). */
  private async persistProcessedSideEffects(
    ports: PersistencePorts,
    command: SubmitCommand,
    tx: WagerTransaction,
    wallet: Wallet,
    snapshot: WalletSnapshot,
    outcome: Extract<EffectOutcome, { type: "processed" }>,
    at: Date,
  ): Promise<void> {
    if (outcome.entry !== null) {
      const affected = await ports.wallets.updateBalance({
        id: wallet.id,
        newBalance: wallet.balance,
        expectedVersion: snapshot.version,
        newVersion: wallet.version,
        at,
      });
      if (affected !== 1) {
        throw new InvariantViolationError("conditional wallet update affected no rows under lock");
      }
      await ports.ledger.insert(outcome.entry);
      await ports.outbox.enqueue(
        balanceChangedEvent({ entry: outcome.entry, eventId: this.ids.next(), causationId: command.causationId, correlationId: command.correlationId }),
        at,
      );
    }
    await ports.outbox.enqueue(
      processedEvent({ tx, eventId: this.ids.next(), causationId: command.causationId }),
      at,
    );
    // Gatilho imediato: dependentes em PENDING_REFERENCE que apontam para esta transação.
    await ports.transactions.rescheduleDependents(command.providerId, command.externalTransactionId, at);
  }

  private async resolveOutcome(
    ports: PersistencePorts,
    command: SubmitCommand,
    money: Money,
    wallet: Wallet,
    txId: string,
    at: Date,
  ): Promise<Outcome> {
    if (wallet.playerId !== command.playerId) {
      return { type: "rejected", failureCode: Codes.WalletPlayerMismatch, balance: wallet.balance };
    }
    if (wallet.currency !== money.currency) {
      return { type: "rejected", failureCode: Codes.CurrencyMismatch, balance: wallet.balance };
    }

    const hasReference = command.referenceExternalTransactionId !== null;
    if (!needsReference(command.kind, hasReference)) {
      return applyEffect({ wallet, kind: command.kind, money, direction: null, entryId: this.ids.next(), txId, at, referenceId: null });
    }

    const reference = await ports.transactions.findByProviderExternal(
      command.providerId,
      command.referenceExternalTransactionId ?? "",
    );
    const isCompensation = command.kind === WagerKind.Refund || command.kind === WagerKind.Rollback;
    const alreadyCompensated =
      reference !== null && reference.status === WagerStatus.Processed && isCompensation
        ? await ports.transactions.hasProcessedCompensation(reference.id)
        : false;

    const resolution = resolveReference({
      kind: command.kind,
      money,
      playerId: command.playerId,
      walletId: command.walletId,
      roundId: command.roundId,
      reference,
      alreadyCompensated,
    });
    if (resolution.type === "pending") {
      return { type: "pending" };
    }
    if (resolution.type === "rejected") {
      return { type: "rejected", failureCode: resolution.failureCode, balance: wallet.balance };
    }
    return applyEffect({
      wallet,
      kind: command.kind,
      money,
      direction: resolution.direction,
      entryId: this.ids.next(),
      txId,
      at,
      referenceId: resolution.reference.id,
    });
  }

  private createTransaction(
    command: SubmitCommand,
    money: Money,
    payloadHash: string,
    walletId: string | null,
    at: Date,
  ): WagerTransaction {
    return WagerTransaction.create({
      id: this.ids.next(),
      providerId: command.providerId,
      externalTransactionId: command.externalTransactionId,
      idempotencyKey: command.idempotencyKey,
      payloadHash,
      requestedWalletId: command.walletId,
      walletId,
      playerId: command.playerId,
      roundId: command.roundId,
      gameId: command.gameId,
      kind: command.kind,
      money,
      referenceExternalTransactionId: command.referenceExternalTransactionId,
      correlationId: command.correlationId,
      createdAt: at,
    });
  }

  private async assertNoExternalConflict(ports: PersistencePorts, command: SubmitCommand): Promise<void> {
    const byExternal = await ports.transactions.findByProviderExternal(
      command.providerId,
      command.externalTransactionId,
    );
    if (byExternal !== null) {
      throw new DuplicateExternalTransactionError();
    }
  }

  private async tryReplay(
    ports: PersistencePorts,
    command: SubmitCommand,
    payloadHash: string,
  ): Promise<SubmitResult | null> {
    const existing = await ports.transactions.findByIdempotencyKey(command.idempotencyKey);
    if (existing !== null) {
      if (!existing.matchesPayload(payloadHash)) {
        throw new IdempotencyKeyConflictError();
      }
      return buildResult(existing, true);
    }
    return null;
  }
}

const INBOX_DUPLICATE: SubmitResult = {
  transactionId: "",
  status: WagerStatus.Processed,
  balance: null,
  failureCode: null,
  idempotentReplay: false,
  inboxDuplicate: true,
  conflict: false,
};

function isConflictError(error: unknown): error is IdempotencyKeyConflictError | DuplicateExternalTransactionError {
  return error instanceof IdempotencyKeyConflictError || error instanceof DuplicateExternalTransactionError;
}

function conflictResult(error: IdempotencyKeyConflictError | DuplicateExternalTransactionError): SubmitResult {
  return {
    transactionId: "",
    status: WagerStatus.Rejected,
    balance: null,
    failureCode: error.failureCode,
    idempotentReplay: false,
    inboxDuplicate: false,
    conflict: true,
  };
}

function buildResult(tx: WagerTransaction, idempotentReplay: boolean): SubmitResult {
  return {
    transactionId: tx.id,
    status: tx.status,
    balance: tx.resultBalance?.toJSON() ?? null,
    failureCode: tx.failureCode,
    idempotentReplay,
    inboxDuplicate: false,
    conflict: false,
  };
}
