import { describe, expect, test } from "bun:test";
import { FailureCode } from "../../src/shared/domain/failure-code";
import { Money } from "../../src/shared/domain/money";
import { LedgerDirection } from "../../src/wallet/domain/ledger-direction";
import { resolveReference } from "../../src/wagering/domain/reference-policy";
import { WagerKind } from "../../src/wagering/domain/wager-kind";
import { WagerTransaction } from "../../src/wagering/domain/wager-transaction";

const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });
const at = new Date("2026-01-01T00:00:00.000Z");

const WALLET = "0192f291-27dd-7d3f-8071-5f8685deef37";
const PLAYER = "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1";

/** Cria uma transação de referência num estado dado (default: BET PROCESSED de 10.00). */
function reference(overrides: {
  kind?: WagerKind;
  status?: "pending" | "pending_reference" | "processed" | "rejected";
  amount?: string;
  walletId?: string;
  playerId?: string;
  roundId?: string | null;
} = {}): WagerTransaction {
  const kind = overrides.kind ?? WagerKind.Bet;
  const money = brl(overrides.amount ?? "10.00");
  const tx = WagerTransaction.create({
    id: "ref-id",
    providerId: "provider-a",
    externalTransactionId: "bet-1",
    idempotencyKey: "provider-a:bet-1",
    payloadHash: "v1:h",
    requestedWalletId: overrides.walletId ?? WALLET,
    walletId: overrides.walletId ?? WALLET,
    playerId: overrides.playerId ?? PLAYER,
    roundId: overrides.roundId ?? "round-1",
    gameId: "game-1",
    kind,
    money,
    referenceExternalTransactionId: null,
    correlationId: "c",
    createdAt: at,
  });
  const status = overrides.status ?? "processed";
  if (status === "processed") {
    tx.markProcessed({ walletId: tx.requestedWalletId, resultBalance: money, referenceTransactionId: null, at });
  } else if (status === "rejected") {
    tx.reject({ failureCode: FailureCode.InsufficientFunds, walletId: tx.requestedWalletId, resultBalance: money, referenceTransactionId: null });
  } else if (status === "pending_reference") {
    tx.markPendingReference({ nextReferenceAttemptAt: at, referenceDeadlineAt: at });
  }
  return tx;
}

const input = (overrides: Partial<Parameters<typeof resolveReference>[0]> = {}): Parameters<typeof resolveReference>[0] => ({
  kind: WagerKind.Refund,
  money: brl("10.00"),
  playerId: PLAYER,
  walletId: WALLET,
  roundId: "round-1",
  reference: reference(),
  alreadyCompensated: false,
  ...overrides,
});

describe("resolveReference (spec §3.4) — ordered rules", () => {
  test("missing reference → pending", () => {
    expect(resolveReference(input({ reference: null })).type).toBe("pending");
  });

  test("reference still PENDING_REFERENCE → pending", () => {
    expect(resolveReference(input({ reference: reference({ status: "pending_reference" }) })).type).toBe("pending");
  });

  test("incompatible kind (REFUND → WIN) → INVALID_REFERENCE_KIND", () => {
    const outcome = resolveReference(input({ reference: reference({ kind: WagerKind.Win }) }));
    expect(outcome).toEqual({ type: "rejected", failureCode: FailureCode.InvalidReferenceKind });
  });

  test("different round → REFERENCE_MISMATCH", () => {
    const outcome = resolveReference(input({ roundId: "round-99" }));
    expect(outcome).toEqual({ type: "rejected", failureCode: FailureCode.ReferenceMismatch });
  });

  test("different wallet → REFERENCE_MISMATCH", () => {
    const outcome = resolveReference(input({ reference: reference({ walletId: crypto.randomUUID() }) }));
    expect(outcome).toEqual({ type: "rejected", failureCode: FailureCode.ReferenceMismatch });
  });

  test("reference REJECTED → REFERENCE_NOT_PROCESSED (after kind/mismatch pass)", () => {
    const outcome = resolveReference(input({ reference: reference({ status: "rejected" }) }));
    expect(outcome).toEqual({ type: "rejected", failureCode: FailureCode.ReferenceNotProcessed });
  });

  test("amount differs → AMOUNT_MISMATCH", () => {
    const outcome = resolveReference(input({ money: brl("20.00") }));
    expect(outcome).toEqual({ type: "rejected", failureCode: FailureCode.AmountMismatch });
  });

  test("already compensated → REFERENCE_ALREADY_REVERSED (ADR-001)", () => {
    const outcome = resolveReference(input({ alreadyCompensated: true }));
    expect(outcome).toEqual({ type: "rejected", failureCode: FailureCode.ReferenceAlreadyReversed });
  });

  test("REFUND of a BET resolves with CREDIT (inverse of the BET debit)", () => {
    const outcome = resolveReference(input());
    expect(outcome.type).toBe("resolved");
    if (outcome.type === "resolved") {
      expect(outcome.direction).toBe(LedgerDirection.Credit);
    }
  });

  test("ROLLBACK of a WIN resolves with DEBIT (inverse of the WIN credit)", () => {
    const outcome = resolveReference(input({ kind: WagerKind.Rollback, reference: reference({ kind: WagerKind.Win }) }));
    expect(outcome.type).toBe("resolved");
    if (outcome.type === "resolved") {
      expect(outcome.direction).toBe(LedgerDirection.Debit);
    }
  });

  test("WIN with an optional reference resolves without a compensation direction", () => {
    const outcome = resolveReference(input({ kind: WagerKind.Win }));
    expect(outcome.type).toBe("resolved");
    if (outcome.type === "resolved") {
      expect(outcome.direction).toBeNull();
    }
  });
});
