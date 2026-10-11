import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eventually } from "../support/async";
import { assertWalletConsistent } from "../support/consistency";
import { pauseContainer, SQS_CONTAINER, unpauseContainer } from "../support/chaos";
import { type MessagingApp, startMessagingApp } from "../support/sqs-app";
import { betBody, openWallet, submit } from "../support/wager";

let app: MessagingApp;

beforeAll(async () => {
  app = await startMessagingApp();
}, 60000);

afterAll(async () => {
  await unpauseContainer(SQS_CONTAINER); // garante que destrava mesmo se o teste falhar
  await app.close();
}, 30000);

async function pendingOutbox(): Promise<number> {
  const rows = await app.db.orm.em
    .getConnection()
    .execute<{ c: number }[]>("SELECT count(*)::int AS c FROM outbox_messages WHERE published_at IS NULL");
  return rows[0]?.c ?? 0;
}

describe("I11 — SQS unavailable (spec §12, docker pause)", () => {
  test("the API keeps working, the outbox accumulates, and drains after recovery", async () => {
    const wallet = await openWallet(app, "1000.00");
    const bet = (external: string): Promise<Response> =>
      submit(app, betBody({ playerId: wallet.playerId, walletId: wallet.id, externalTransactionId: external, money: { amount: "1.00", currency: "BRL" } }));

    await pauseContainer(SQS_CONTAINER);
    try {
      // Com o SQS parado, a API continua respondendo (só toca Postgres + outbox).
      for (let i = 0; i < 3; i += 1) {
        const response = await bet(crypto.randomUUID());
        expect(response.status).toBe(201);
      }
      await eventually(async () => {
        expect(await pendingOutbox()).toBeGreaterThan(0);
      }, { timeoutMs: 5000, intervalMs: 200 });

      const ready = await app.request("/health/ready");
      expect(ready.status).toBe(503);
    } finally {
      await unpauseContainer(SQS_CONTAINER);
    }

    await eventually(async () => {
      expect(await pendingOutbox()).toBe(0);
    }, { timeoutMs: 30000, intervalMs: 300 });
    await eventually(async () => {
      const ready = await app.request("/health/ready");
      expect(ready.status).toBe(200);
    }, { timeoutMs: 15000, intervalMs: 300 });

    await assertWalletConsistent(app.db.orm, wallet.id);
  }, 90000);
});
