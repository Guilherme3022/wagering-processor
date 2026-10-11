import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eventually } from "../support/async";
import { type MessagingApp, startMessagingApp } from "../support/sqs-app";
import { openWallet } from "../support/wager";

let app: MessagingApp;

beforeAll(async () => {
  // Injeta falha transitória em todo processamento do consumer (só em NODE_ENV=test).
  app = await startMessagingApp({ FAULT_INJECTION: "fail_transient", NODE_ENV: "test", SQS_MAX_RECEIVE_COUNT: "2" });
}, 60000);

afterAll(async () => {
  await app.close();
  delete process.env.FAULT_INJECTION; // não contamina os outros arquivos de teste
});

describe("I7 — transient errors are retried and then redriven to the DLQ (ADR-010)", () => {
  test("a message that keeps failing transitorily ends up in the DLQ via redrive", async () => {
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
      money: { amount: "10.00", currency: "BRL" },
      idempotencyKey: `provider-a:${external}`,
    });

    // A cada recebimento o consumer lança transitório → ChangeMessageVisibility (não deleta).
    // Ao atingir maxReceiveCount, o consumer move à DLQ explicitamente. Nunca aplicou efeito.
    await eventually(
      async () => {
        const dlq = await app.sqs.receive(app.dlqQueue, { maxMessages: 10, waitSeconds: 1, visibilityTimeout: 1 });
        expect(dlq.length).toBeGreaterThanOrEqual(1);
      },
      { timeoutMs: 40000, intervalMs: 500 },
    );

    const read = await app.request(`/wallets/${wallet.id}`);
    expect(((await read.json()) as { balance: { amount: string } }).balance.amount).toBe("100.00");
  }, 60000);
});
