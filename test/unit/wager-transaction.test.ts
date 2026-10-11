import { describe, expect, test } from "bun:test";
import { FailureCode } from "../../src/shared/domain/failure-code";
import { Money } from "../../src/shared/domain/money";
import { LedgerDirection } from "../../src/wallet/domain/ledger-direction";
import {
  acceptsReferenceKind,
  forbidsReference,
  inverseDirection,
  requiresReference,
  WagerKind,
} from "../../src/wagering/domain/wager-kind";
import { isTerminal, WagerStatus } from "../../src/wagering/domain/wager-status";
import { InvalidTransactionStateError } from "../../src/wagering/domain/wager-transaction-errors";
import { WagerTransaction } from "../../src/wagering/domain/wager-transaction";

const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });
const at = new Date("2026-01-01T00:00:00.000Z");

const newTransaction = (overrides: Partial<Parameters<typeof WagerTransaction.create>[0]> = {}) =>
  WagerTransaction.create({
    id: "tx-1",
    providerId: "provider-a",
    externalTransactionId: "ext-1",
    idempotencyKey: "provider-a:ext-1",
    payloadHash: "v1:hash",
    requestedWalletId: "wallet-1",
    walletId: "wallet-1",
    playerId: "player-1",
    roundId: "round-1",
    gameId: "game-1",
    kind: WagerKind.Bet,
    money: brl("25.00"),
    referenceExternalTransactionId: null,
    correlationId: "corr-1",
    createdAt: at,
    ...overrides,
  });

describe("WagerKind rules (spec §3.4)", () => {
  test("REFUND and ROLLBACK require a reference", () => {
    expect(requiresReference(WagerKind.Refund)).toBe(true);
    expect(requiresReference(WagerKind.Rollback)).toBe(true);
    expect(requiresReference(WagerKind.Bet)).toBe(false);
  });

  test("BET and OPENING forbid a reference", () => {
    expect(forbidsReference(WagerKind.Bet)).toBe(true);
    expect(forbidsReference(WagerKind.Opening)).toBe(true);
    expect(forbidsReference(WagerKind.Win)).toBe(false);
  });

  test("REFUND only targets BET; ROLLBACK targets BET/WIN/REFUND; never ROLLBACK", () => {
    expect(acceptsReferenceKind(WagerKind.Refund, WagerKind.Bet)).toBe(true);
    expect(acceptsReferenceKind(WagerKind.Refund, WagerKind.Win)).toBe(false);
    expect(acceptsReferenceKind(WagerKind.Rollback, WagerKind.Bet)).toBe(true);
    expect(acceptsReferenceKind(WagerKind.Rollback, WagerKind.Win)).toBe(true);
    expect(acceptsReferenceKind(WagerKind.Rollback, WagerKind.Refund)).toBe(true);
    expect(acceptsReferenceKind(WagerKind.Rollback, WagerKind.Rollback)).toBe(false);
  });

  test("inverseDirection flips credit and debit", () => {
    expect(inverseDirection(LedgerDirection.Credit)).toBe(LedgerDirection.Debit);
    expect(inverseDirection(LedgerDirection.Debit)).toBe(LedgerDirection.Credit);
  });
});

describe("WagerStatus", () => {
  test("terminal states are PROCESSED, REJECTED, FAILED", () => {
    expect(isTerminal(WagerStatus.Processed)).toBe(true);
    expect(isTerminal(WagerStatus.Rejected)).toBe(true);
    expect(isTerminal(WagerStatus.Failed)).toBe(true);
    expect(isTerminal(WagerStatus.Pending)).toBe(false);
    expect(isTerminal(WagerStatus.PendingReference)).toBe(false);
  });
});

describe("WagerTransaction state machine (spec §3.4)", () => {
  test("create validates the kind × reference invariant (challenge §6.3)", () => {
    expect(() => newTransaction({ kind: WagerKind.Refund, referenceExternalTransactionId: null })).toThrow();
    expect(() => newTransaction({ kind: WagerKind.Rollback, referenceExternalTransactionId: null })).toThrow();
    expect(() => newTransaction({ kind: WagerKind.Bet, referenceExternalTransactionId: "ext-0" })).toThrow();
    // combinações válidas não lançam
    expect(() => newTransaction({ kind: WagerKind.Refund, referenceExternalTransactionId: "ext-0" })).not.toThrow();
    expect(() => newTransaction({ kind: WagerKind.Bet, referenceExternalTransactionId: null })).not.toThrow();
  });

  test("is created PENDING with no result snapshot", () => {
    const tx = newTransaction();
    expect(tx.status).toBe(WagerStatus.Pending);
    expect(tx.failureCode).toBeNull();
    expect(tx.resultBalance).toBeNull();
    expect(tx.affectsBalance()).toBe(true);
  });

  test("LOSS does not affect the balance", () => {
    expect(newTransaction({ kind: WagerKind.Loss }).affectsBalance()).toBe(false);
  });

  test("markProcessed records the result snapshot for replay", () => {
    const tx = newTransaction();
    tx.markProcessed({
      walletId: "wallet-1",
      resultBalance: brl("975.00"),
      referenceTransactionId: null,
      at,
    });
    expect(tx.status).toBe(WagerStatus.Processed);
    expect(tx.resultBalance?.toString()).toBe("975.00");
    expect(tx.processedAt).toEqual(at);
  });

  test("reject records the failure code and the observed balance", () => {
    const tx = newTransaction();
    tx.reject({
      failureCode: FailureCode.InsufficientFunds,
      walletId: "wallet-1",
      resultBalance: brl("10.00"),
      referenceTransactionId: null,
    });
    expect(tx.status).toBe(WagerStatus.Rejected);
    expect(tx.failureCode).toBe(FailureCode.InsufficientFunds);
    expect(tx.resultBalance?.toString()).toBe("10.00");
  });

  test("PENDING_REFERENCE counts attempts across re-entries", () => {
    const tx = newTransaction({ kind: WagerKind.Refund, referenceExternalTransactionId: "ext-0" });
    const deadline = new Date("2026-01-02T00:00:00.000Z");
    tx.markPendingReference({ nextReferenceAttemptAt: at, referenceDeadlineAt: deadline });
    expect(tx.status).toBe(WagerStatus.PendingReference);
    expect(tx.referenceAttempts).toBe(0);
    tx.markPendingReference({ nextReferenceAttemptAt: at, referenceDeadlineAt: deadline });
    expect(tx.referenceAttempts).toBe(1);
  });

  test("PENDING_REFERENCE can still resolve to PROCESSED", () => {
    const tx = newTransaction({ kind: WagerKind.Refund, referenceExternalTransactionId: "ext-0" });
    tx.markPendingReference({
      nextReferenceAttemptAt: at,
      referenceDeadlineAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    tx.markProcessed({
      walletId: "wallet-1",
      resultBalance: brl("1000.00"),
      referenceTransactionId: "ref-tx",
      at,
    });
    expect(tx.status).toBe(WagerStatus.Processed);
  });

  test("matchesPayload distinguishes replay from idempotency conflict (spec §6.3)", () => {
    const tx = newTransaction({ payloadHash: "v1:abc" });
    expect(tx.matchesPayload("v1:abc")).toBe(true);
    expect(tx.matchesPayload("v1:different")).toBe(false);
  });

  test("transitioning out of a terminal state is a bug", () => {
    const tx = newTransaction();
    tx.markProcessed({ walletId: "wallet-1", resultBalance: brl("975.00"), referenceTransactionId: null, at });
    expect(() =>
      tx.reject({
        failureCode: FailureCode.InsufficientFunds,
        walletId: "wallet-1",
        resultBalance: brl("0.00"),
        referenceTransactionId: null,
      }),
    ).toThrow(InvalidTransactionStateError);
  });
});
