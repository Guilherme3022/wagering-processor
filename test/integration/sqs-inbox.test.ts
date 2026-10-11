import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eventually } from "../support/async";
import { assertWalletConsistent } from "../support/consistency";
import { type MessageData, type MessagingApp, startMessagingApp } from "../support/sqs-app";
import { openWallet } from "../support/wager";

let app: MessagingApp;

beforeAll(async () => {
  app = await startMessagingApp();
});

afterAll(async () => {
  await app.close();
});

const balanceOf = async (walletId: string): Promise<string> => {
  const read = await app.request(`/wallets/${walletId}`);
  return ((await read.json()) as { balance: { amount: string } }).balance.amount;
};

const betData = (walletId: string, playerId: string, amount: string, external: string): MessageData => ({
  providerId: "provider-a",
  externalTransactionId: external,
  playerId,
  walletId,
  roundId: "round-1",
  gameId: "game-1",
  kind: "BET",
  money: { amount, currency: "BRL" },
  idempotencyKey: `provider-a:${external}`,
});

describe("I6 — inbox and redelivery (spec §6.6)", () => {
  test("the same message delivered twice has a single effect", async () => {
    const wallet = await openWallet(app, "100.00");
    const messageId = crypto.randomUUID();
    const data = betData(wallet.id, wallet.playerId, "25.00", crypto.randomUUID());

    // Dois envios físicos distintos (dedup diferente) da MESMA mensagem lógica.
    await app.send(messageId, data, `${messageId}:a`);
    await app.send(messageId, data, `${messageId}:b`);

    await eventually(async () => {
      expect(await balanceOf(wallet.id)).toBe("75.00");
    }, { timeoutMs: 15000, intervalMs: 150 });

    // Dá tempo da segunda entrega ser consumida e confirmada sem efeito.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await balanceOf(wallet.id)).toBe("75.00");
    await assertWalletConsistent(app.db.orm, wallet.id);
  });

  test("an idempotency conflict still records the inbox, so the messageId cannot be reused", async () => {
    const wallet = await openWallet(app, "100.00");
    const external = crypto.randomUUID();
    const key = `provider-a:${external}`;
    // 1) BET 10 aceita.
    await app.send(crypto.randomUUID(), betData(wallet.id, wallet.playerId, "10.00", external));
    await eventually(async () => {
      expect(await balanceOf(wallet.id)).toBe("90.00");
    }, { timeoutMs: 15000, intervalMs: 150 });

    // 2) Mesmo key, payload diferente (20.00) com um messageId próprio → conflito de idempotência.
    const conflictMessageId = crypto.randomUUID();
    await app.send(conflictMessageId, { ...betData(wallet.id, wallet.playerId, "20.00", external), idempotencyKey: key });

    // A inbox PRECISA registrar o messageId do conflito (spec §6.1), e o saldo não muda.
    await eventually(async () => {
      const rows = await app.db.orm.em
        .getConnection()
        .execute<{ c: number }[]>("SELECT count(*)::int AS c FROM inbox_messages WHERE message_id = ?", [conflictMessageId]);
      expect(rows[0]?.c).toBe(1);
    }, { timeoutMs: 15000, intervalMs: 150 });
    expect(await balanceOf(wallet.id)).toBe("90.00");

    // 3) Reenvio do MESMO messageId com outro payload → reutilização inválida → DLQ (não reprocessa).
    await app.send(conflictMessageId, { ...betData(wallet.id, wallet.playerId, "30.00", external), idempotencyKey: key }, `${conflictMessageId}:again`);
    await eventually(async () => {
      const dlq = await app.sqs.receive(app.dlqQueue, { maxMessages: 10, waitSeconds: 1, visibilityTimeout: 1 });
      expect(dlq.length).toBeGreaterThanOrEqual(1);
    }, { timeoutMs: 15000, intervalMs: 200 });
    expect(await balanceOf(wallet.id)).toBe("90.00");
    await assertWalletConsistent(app.db.orm, wallet.id);
  });

  test("the same messageId with a different payload goes to the DLQ", async () => {
    const wallet = await openWallet(app, "100.00");
    const messageId = crypto.randomUUID();
    const external = crypto.randomUUID();
    await app.send(messageId, betData(wallet.id, wallet.playerId, "10.00", external));

    await eventually(async () => {
      expect(await balanceOf(wallet.id)).toBe("90.00");
    }, { timeoutMs: 15000, intervalMs: 150 });

    // Mesmo messageId, payload diferente → conflito de inbox → DLQ.
    await app.send(messageId, betData(wallet.id, wallet.playerId, "20.00", external), `${messageId}:conflict`);

    await eventually(async () => {
      const dlq = await app.sqs.receive(app.dlqQueue, { maxMessages: 10, waitSeconds: 1, visibilityTimeout: 1 });
      expect(dlq.length).toBeGreaterThanOrEqual(1);
    }, { timeoutMs: 15000, intervalMs: 200 });

    expect(await balanceOf(wallet.id)).toBe("90.00");
    await assertWalletConsistent(app.db.orm, wallet.id);
  });
});
