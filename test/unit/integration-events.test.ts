import { describe, expect, test } from "bun:test";
import {
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
} from "../../src/shared/events/wagering-events";

const occurredAt = new Date("2026-01-01T12:00:00.000Z");

describe("integration event envelopes (spec §8.3)", () => {
  test("WagerTransactionProcessed toJSON locks the contract", () => {
    const event = WagerTransactionProcessed.from({
      eventId: "0192f300-0000-7000-8000-000000000001",
      aggregateId: "wallet-1",
      occurredAt,
      context: { correlationId: "corr-1", causationId: "cause-1" },
      data: {
        transactionId: "tx-1",
        providerId: "provider-a",
        externalTransactionId: "ext-1",
        walletId: "wallet-1",
        playerId: "player-1",
        roundId: "round-1",
        gameId: "game-1",
        kind: "BET",
        money: { amount: "25.00", currency: "BRL" },
        referenceTransactionId: null,
        balanceAfter: { amount: "975.00", currency: "BRL" },
        processedAt: occurredAt.toISOString(),
      },
    });

    expect(event.toJSON()).toEqual({
      eventId: "0192f300-0000-7000-8000-000000000001",
      eventType: "WagerTransactionProcessed",
      aggregateId: "wallet-1",
      correlationId: "corr-1",
      causationId: "cause-1",
      occurredAt: "2026-01-01T12:00:00.000Z",
      version: 1,
      data: {
        transactionId: "tx-1",
        providerId: "provider-a",
        externalTransactionId: "ext-1",
        walletId: "wallet-1",
        playerId: "player-1",
        roundId: "round-1",
        gameId: "game-1",
        kind: "BET",
        money: { amount: "25.00", currency: "BRL" },
        referenceTransactionId: null,
        balanceAfter: { amount: "975.00", currency: "BRL" },
        processedAt: "2026-01-01T12:00:00.000Z",
      },
    });
  });

  test("the envelope omits causationId when absent", () => {
    const event = WagerTransactionRejected.from({
      eventId: "evt-2",
      aggregateId: "wallet-1",
      occurredAt,
      context: { correlationId: "corr-1" },
      data: {
        transactionId: "tx-2",
        providerId: "provider-a",
        externalTransactionId: "ext-2",
        walletId: null,
        requestedWalletId: "wallet-1",
        kind: "BET",
        money: { amount: "25.00", currency: "BRL" },
        failureCode: "WALLET_NOT_FOUND",
        rejectedAt: occurredAt.toISOString(),
      },
    });

    const envelope = event.toJSON();
    expect(envelope).not.toHaveProperty("causationId");
    expect(envelope.eventType).toBe("WagerTransactionRejected");
  });

  test("WalletBalanceChanged carries money as strings only", () => {
    const envelope = WalletBalanceChanged.from({
      eventId: "evt-3",
      aggregateId: "wallet-1",
      occurredAt,
      context: { correlationId: "corr-1" },
      data: {
        walletId: "wallet-1",
        transactionId: "tx-3",
        direction: "DEBIT",
        money: { amount: "25.00", currency: "BRL" },
        balanceBefore: { amount: "1000.00", currency: "BRL" },
        balanceAfter: { amount: "975.00", currency: "BRL" },
        walletVersion: 2,
      },
    }).toJSON();

    expect(JSON.stringify(envelope)).toContain('"amount":"25.00"');
    expect(envelope.version).toBe(1);
  });

  test("WagerTransactionPendingReference names its type", () => {
    const envelope = WagerTransactionPendingReference.from({
      eventId: "evt-4",
      aggregateId: "wallet-1",
      occurredAt,
      context: { correlationId: "corr-1" },
      data: {
        transactionId: "tx-4",
        providerId: "provider-a",
        externalTransactionId: "ext-4",
        walletId: "wallet-1",
        kind: "REFUND",
        referenceExternalTransactionId: "ext-0",
        deadlineAt: occurredAt.toISOString(),
      },
    }).toJSON();

    expect(envelope.eventType).toBe("WagerTransactionPendingReference");
  });
});
