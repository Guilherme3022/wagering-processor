import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startTestApp, type TestApp } from "../support/app";
import { assertWalletConsistent } from "../support/consistency";
import { betBody, openWallet, submit, type SubmitResponse } from "../support/wager";

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.close();
});

describe("C1 — same bet 50x in parallel", () => {
  test("applies one debit and replays the other 49 identically", async () => {
    const wallet = await openWallet(app, "100.00");
    const body = betBody({
      playerId: wallet.playerId,
      walletId: wallet.id,
      money: { amount: "25.00", currency: "BRL" },
    });

    const responses = await Promise.all(Array.from({ length: 50 }, () => submit(app, body)));
    const bodies = (await Promise.all(responses.map((r) => r.json()))) as SubmitResponse[];

    const created = responses.filter((r) => r.status === 201);
    const replays = responses.filter((r) => r.status === 200);
    expect(created.length).toBe(1);
    expect(replays.length).toBe(49);

    const transactionIds = new Set(bodies.map((b) => b.transactionId));
    expect(transactionIds.size).toBe(1);
    for (const b of bodies) {
      expect(b.balance?.amount).toBe("75.00");
    }

    await assertWalletConsistent(app.db.orm, wallet.id);
    const read = await app.request(`/wallets/${wallet.id}`);
    expect(((await read.json()) as { balance: { amount: string } }).balance.amount).toBe("75.00");
  });
});
