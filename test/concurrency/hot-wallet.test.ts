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

describe("C2 — two competing bets on the same wallet", () => {
  test("100.00 with two 80.00 bets: one PROCESSED, one INSUFFICIENT_FUNDS, balance 20.00", async () => {
    const wallet = await openWallet(app, "100.00");
    const makeBet = (): Promise<Response> =>
      submit(
        app,
        betBody({ playerId: wallet.playerId, walletId: wallet.id, money: { amount: "80.00", currency: "BRL" } }),
      );

    const [a, b] = await Promise.all([makeBet(), makeBet()]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 422]);

    const bodies = (await Promise.all([a.json(), b.json()])) as SubmitResponse[];
    const processed = bodies.find((x) => x.status === "PROCESSED");
    const rejected = bodies.find((x) => x.status === "REJECTED");
    expect(processed?.balance?.amount).toBe("20.00");
    expect(rejected?.failureCode).toBe("INSUFFICIENT_FUNDS");

    await assertWalletConsistent(app.db.orm, wallet.id);
    const read = await app.request(`/wallets/${wallet.id}`);
    expect(((await read.json()) as { balance: { amount: string } }).balance.amount).toBe("20.00");
  });
});
