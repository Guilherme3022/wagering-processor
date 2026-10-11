import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eventually } from "../support/async";
import { assertWalletConsistent } from "../support/consistency";
import { type MessagingApp, startMessagingApp } from "../support/sqs-app";
import { openWallet } from "../support/wager";

let app: MessagingApp;

beforeAll(async () => {
  app = await startMessagingApp();
});

afterAll(async () => {
  await app.close();
});

describe("I7 — consumer error handling (spec §6.6, ADR-010)", () => {
  test("an invalid envelope goes straight to the DLQ", async () => {
    await app.sqs.sendOne(app.inputQueue, {
      id: crypto.randomUUID(),
      body: "this is not json",
      groupId: "bad",
      deduplicationId: crypto.randomUUID(),
    });

    await eventually(async () => {
      const dlq = await app.sqs.receive(app.dlqQueue, { maxMessages: 10, waitSeconds: 1, visibilityTimeout: 1 });
      expect(dlq.length).toBeGreaterThanOrEqual(1);
    }, { timeoutMs: 15000, intervalMs: 200 });
  });

  test("P2-2: an invalid money payload goes to the DLQ, never silently acked", async () => {
    const wallet = await openWallet(app, "100.00");
    const external = crypto.randomUUID();
    await app.send(crypto.randomUUID(), {
      providerId: "provider-a",
      externalTransactionId: external,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "round-1",
      gameId: "game-1",
      kind: "BET",
      money: { amount: "1", currency: "BRL" }, // escala inválida (ADR-003)
      idempotencyKey: `provider-a:${external}`,
    });

    await eventually(async () => {
      const dlq = await app.sqs.receive(app.dlqQueue, { maxMessages: 10, waitSeconds: 1, visibilityTimeout: 1 });
      expect(dlq.length).toBeGreaterThanOrEqual(1);
    }, { timeoutMs: 15000, intervalMs: 200 });

    // Não persistiu nada e o saldo não mudou.
    const read = await app.request(`/wallets/${wallet.id}`);
    expect(((await read.json()) as { balance: { amount: string } }).balance.amount).toBe("100.00");
    const stored = await app.request(`/providers/provider-a/wagering/transactions/${external}`);
    expect(stored.status).toBe(404);
    await assertWalletConsistent(app.db.orm, wallet.id);
  });

  test("a business rejection is persisted and acked, not sent to the DLQ", async () => {
    const wallet = await openWallet(app, "20.00");
    const external = crypto.randomUUID();
    await app.send(crypto.randomUUID(), {
      providerId: "provider-a",
      externalTransactionId: external,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "round-1",
      gameId: "game-1",
      kind: "BET",
      money: { amount: "80.00", currency: "BRL" },
      idempotencyKey: `provider-a:${external}`,
    });

    await eventually(async () => {
      const read = await app.request(`/providers/provider-a/wagering/transactions/${external}`);
      expect(read.status).toBe(200);
      const body = (await read.json()) as { status: string; failureCode: string };
      expect(body.status).toBe("REJECTED");
      expect(body.failureCode).toBe("INSUFFICIENT_FUNDS");
    }, { timeoutMs: 15000, intervalMs: 150 });
    await assertWalletConsistent(app.db.orm, wallet.id);
  });
});
