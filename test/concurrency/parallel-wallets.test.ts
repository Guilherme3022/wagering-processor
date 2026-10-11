import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startTestApp, type TestApp } from "../support/app";
import { assertWalletConsistent } from "../support/consistency";
import { betBody, openWallet, submit } from "../support/wager";

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.close();
});

describe("C3 — many wallets in parallel do not interfere", () => {
  test("20 wallets x 20 bets each, all consistent", async () => {
    const wallets = await Promise.all(Array.from({ length: 20 }, () => openWallet(app, "100.00")));

    const requests = wallets.flatMap((wallet) =>
      Array.from({ length: 20 }, () =>
        submit(
          app,
          betBody({ playerId: wallet.playerId, walletId: wallet.id, money: { amount: "1.00", currency: "BRL" } }),
        ),
      ),
    );

    const responses = await Promise.all(requests);
    expect(responses.every((r) => r.status === 201)).toBe(true);

    for (const wallet of wallets) {
      await assertWalletConsistent(app.db.orm, wallet.id);
      const read = await app.request(`/wallets/${wallet.id}`);
      expect(((await read.json()) as { balance: { amount: string } }).balance.amount).toBe("80.00");
    }
  });
});
