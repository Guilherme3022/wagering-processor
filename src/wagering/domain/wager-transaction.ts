import { InvariantViolationError } from "../../shared/domain/domain-error";
import { type FailureCode } from "../../shared/domain/failure-code";
import { type Money } from "../../shared/domain/money";
import { forbidsReference, requiresReference, WagerKind } from "./wager-kind";
import { InvalidTransactionStateError } from "./wager-transaction-errors";
import { isTerminal, WagerStatus } from "./wager-status";

/** Campos imutáveis de identidade de uma transação. O banco guarda-os via trigger (spec §4.2). */
export interface WagerTransactionParams {
  readonly id: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly requestedWalletId: string;
  readonly walletId: string | null;
  readonly playerId: string;
  readonly roundId: string | null;
  readonly gameId: string | null;
  readonly kind: WagerKind;
  readonly money: Money;
  readonly referenceExternalTransactionId: string | null;
  readonly correlationId: string;
  readonly createdAt: Date;
}

export interface WagerTransactionSnapshot extends WagerTransactionParams {
  readonly referenceTransactionId: string | null;
  readonly status: WagerStatus;
  readonly failureCode: FailureCode | null;
  readonly resultBalance: Money | null;
  readonly referenceAttempts: number;
  readonly nextReferenceAttemptAt: Date | null;
  readonly referenceDeadlineAt: Date | null;
  readonly processedAt: Date | null;
}

export interface ProcessedParams {
  readonly walletId: string;
  readonly resultBalance: Money;
  readonly referenceTransactionId: string | null;
  readonly at: Date;
}

export interface RejectedParams {
  readonly failureCode: FailureCode;
  readonly walletId: string | null;
  readonly resultBalance: Money | null;
  readonly referenceTransactionId: string | null;
}

export interface PendingReferenceParams {
  readonly nextReferenceAttemptAt: Date;
  readonly referenceDeadlineAt: Date;
}

/**
 * Agregado de uma operação de aposta (spec §3.4). Construtor privado; nasce `PENDING` e segue a
 * máquina de estados por métodos de transição nomeados. Transição de estado terminal é bug
 * (`InvalidTransactionStateError`). O resultado terminal (`resultBalance`, `failureCode`) é o
 * snapshot usado no replay (spec §6.2), montado só a partir do que está persistido.
 */
export class WagerTransaction {
  private constructor(
    private readonly params: WagerTransactionParams,
    private _walletId: string | null,
    private _referenceTransactionId: string | null,
    private _status: WagerStatus,
    private _failureCode: FailureCode | null,
    private _resultBalance: Money | null,
    private _referenceAttempts: number,
    private _nextReferenceAttemptAt: Date | null,
    private _referenceDeadlineAt: Date | null,
    private _processedAt: Date | null,
  ) {}

  static create(params: WagerTransactionParams): WagerTransaction {
    // Invariantes de kind × referência no próprio agregado (challenge §6.3), além da borda e do banco.
    const hasReference = params.referenceExternalTransactionId !== null;
    if (requiresReference(params.kind) && !hasReference) {
      throw new InvariantViolationError(`${params.kind} requires a reference`);
    }
    if (forbidsReference(params.kind) && hasReference) {
      throw new InvariantViolationError(`${params.kind} must not carry a reference`);
    }
    return new WagerTransaction(
      params,
      params.walletId,
      null,
      WagerStatus.Pending,
      null,
      null,
      0,
      null,
      null,
      null,
    );
  }

  static rehydrate(snapshot: WagerTransactionSnapshot): WagerTransaction {
    return new WagerTransaction(
      snapshot,
      snapshot.walletId,
      snapshot.referenceTransactionId,
      snapshot.status,
      snapshot.failureCode,
      snapshot.resultBalance,
      snapshot.referenceAttempts,
      snapshot.nextReferenceAttemptAt,
      snapshot.referenceDeadlineAt,
      snapshot.processedAt,
    );
  }

  get id(): string {
    return this.params.id;
  }
  get providerId(): string {
    return this.params.providerId;
  }
  get externalTransactionId(): string {
    return this.params.externalTransactionId;
  }
  get idempotencyKey(): string {
    return this.params.idempotencyKey;
  }
  get payloadHash(): string {
    return this.params.payloadHash;
  }
  get requestedWalletId(): string {
    return this.params.requestedWalletId;
  }
  get playerId(): string {
    return this.params.playerId;
  }
  get roundId(): string | null {
    return this.params.roundId;
  }
  get gameId(): string | null {
    return this.params.gameId;
  }
  get kind(): WagerKind {
    return this.params.kind;
  }
  get money(): Money {
    return this.params.money;
  }
  get referenceExternalTransactionId(): string | null {
    return this.params.referenceExternalTransactionId;
  }
  get correlationId(): string {
    return this.params.correlationId;
  }
  get createdAt(): Date {
    return this.params.createdAt;
  }
  get walletId(): string | null {
    return this._walletId;
  }
  get referenceTransactionId(): string | null {
    return this._referenceTransactionId;
  }
  get status(): WagerStatus {
    return this._status;
  }
  get failureCode(): FailureCode | null {
    return this._failureCode;
  }
  get resultBalance(): Money | null {
    return this._resultBalance;
  }
  get referenceAttempts(): number {
    return this._referenceAttempts;
  }
  get nextReferenceAttemptAt(): Date | null {
    return this._nextReferenceAttemptAt;
  }
  get referenceDeadlineAt(): Date | null {
    return this._referenceDeadlineAt;
  }
  get processedAt(): Date | null {
    return this._processedAt;
  }

  isTerminal(): boolean {
    return isTerminal(this._status);
  }

  /** A mesma idempotency key é replay (payload igual) ou conflito (payload diferente)? (spec §6.3) */
  matchesPayload(payloadHash: string): boolean {
    return this.params.payloadHash === payloadHash;
  }

  /** `LOSS` não gera lançamento; os demais kinds mudam o saldo (spec §3.4). */
  affectsBalance(): boolean {
    return this.params.kind !== WagerKind.Loss;
  }

  /** Transição para processada com sucesso. `walletId` é resolvido aqui se ainda não era. */
  markProcessed(params: ProcessedParams): void {
    this.assertNotTerminal(WagerStatus.Processed);
    this._walletId = params.walletId;
    this._referenceTransactionId = params.referenceTransactionId;
    this._resultBalance = params.resultBalance;
    this._processedAt = params.at;
    this._status = WagerStatus.Processed;
    this._failureCode = null;
    this._nextReferenceAttemptAt = null;
    this._referenceDeadlineAt = null;
  }

  /** Rejeição de negócio persistida (entra em replay, spec §6.2). */
  reject(params: RejectedParams): void {
    this.assertNotTerminal(WagerStatus.Rejected);
    if (params.walletId !== null) {
      this._walletId = params.walletId;
    }
    this._referenceTransactionId = params.referenceTransactionId;
    this._failureCode = params.failureCode;
    this._resultBalance = params.resultBalance;
    this._status = WagerStatus.Rejected;
    this._nextReferenceAttemptAt = null;
    this._referenceDeadlineAt = null;
  }

  /** Erro permanente não-negócio em transação já persistida (spec §3.4). */
  fail(failureCode: FailureCode): void {
    this.assertNotTerminal(WagerStatus.Failed);
    this._failureCode = failureCode;
    this._status = WagerStatus.Failed;
  }

  /** Entra (ou permanece) em `PENDING_REFERENCE` aguardando a referência chegar (ADR-004). */
  markPendingReference(params: PendingReferenceParams): void {
    this.assertNotTerminal(WagerStatus.PendingReference);
    if (this._status === WagerStatus.PendingReference) {
      this._referenceAttempts += 1;
    }
    this._nextReferenceAttemptAt = params.nextReferenceAttemptAt;
    this._referenceDeadlineAt = params.referenceDeadlineAt;
    this._status = WagerStatus.PendingReference;
  }

  private assertNotTerminal(to: WagerStatus): void {
    if (isTerminal(this._status)) {
      throw new InvalidTransactionStateError(this._status, to);
    }
  }
}
