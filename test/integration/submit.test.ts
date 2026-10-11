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

const json = async (res: Response): Promise<SubmitResponse> => (await res.json()) as SubmitResponse;

describe("BET/WIN/LOSS via HTTP (spec §6.1)", () => {
  test("BET debits, WIN credits, LOSS leaves the balance untouched", async () => {
    const wallet = await openWallet(app, "100.00");
    const base = { playerId: wallet.playerId, walletId: wallet.id };

    const bet = await submit(app, betBody({ ...base, kind: "BET", money: { amount: "25.00", currency: "BRL" } }));
    expect(bet.status).toBe(201);
    expect((await json(bet)).balance?.amount).toBe("75.00");

    const win = await submit(app, betBody({ ...base, kind: "WIN", money: { amount: "50.00", currency: "BRL" } }));
    expect(win.status).toBe(201);
    expect((await json(win)).balance?.amount).toBe("125.00");

    const loss = await submit(app, betBody({ ...base, kind: "LOSS", money: { amount: "10.00", currency: "BRL" } }));
    expect(loss.status).toBe(201);
    const lossBody = await json(loss);
    expect(lossBody.balance?.amount).toBe("125.00");

    await assertWalletConsistent(app.db.orm, wallet.id);
  });

  test("I3: identical replay returns 200 with the same result and no extra debit", async () => {
    const wallet = await openWallet(app, "100.00");
    const body = betBody({ playerId: wallet.playerId, walletId: wallet.id, money: { amount: "30.00", currency: "BRL" } });

    const first = await submit(app, body);
    expect(first.status).toBe(201);
    const firstBody = await json(first);

    const replay = await submit(app, body);
    expect(replay.status).toBe(200);
    const replayBody = await json(replay);
    expect(replayBody.idempotentReplay).toBe(true);
    expect(replayBody.transactionId).toBe(firstBody.transactionId);
    expect(replayBody.balance?.amount).toBe("70.00");

    await assertWalletConsistent(app.db.orm, wallet.id);
  });

  test("I3: same key with a different payload is a 409 conflict", async () => {
    const wallet = await openWallet(app, "100.00");
    const external = crypto.randomUUID();
    const key = `provider-a:${external}`;
    await submit(app, betBody({ playerId: wallet.playerId, walletId: wallet.id, externalTransactionId: external, money: { amount: "10.00", currency: "BRL" } }), key);
    const conflict = await submit(app, betBody({ playerId: wallet.playerId, walletId: wallet.id, externalTransactionId: external, money: { amount: "20.00", currency: "BRL" } }), key);
    expect(conflict.status).toBe(409);
    expect((await conflict.json() as { code: string }).code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    await assertWalletConsistent(app.db.orm, wallet.id);
  });

  test("I3: same (provider, external) with a different key is a 409 duplicate", async () => {
    const wallet = await openWallet(app, "100.00");
    const external = crypto.randomUUID();
    const body = betBody({ playerId: wallet.playerId, walletId: wallet.id, externalTransactionId: external });
    await submit(app, body, `key-one-${external}`);
    const dup = await submit(app, body, `key-two-${external}`);
    expect(dup.status).toBe(409);
    expect((await dup.json() as { code: string }).code).toBe("DUPLICATE_EXTERNAL_TRANSACTION");
    await assertWalletConsistent(app.db.orm, wallet.id);
  });

  test("insufficient funds is a persisted 422 rejection that replays", async () => {
    const wallet = await openWallet(app, "20.00");
    const body = betBody({ playerId: wallet.playerId, walletId: wallet.id, money: { amount: "80.00", currency: "BRL" } });
    const rejected = await submit(app, body);
    expect(rejected.status).toBe(422);
    const rejectedBody = await json(rejected);
    expect(rejectedBody.failureCode).toBe("INSUFFICIENT_FUNDS");
    expect(rejectedBody.balance?.amount).toBe("20.00");

    const replay = await submit(app, body);
    expect(replay.status).toBe(422);
    expect((await json(replay)).idempotentReplay).toBe(true);

    await assertWalletConsistent(app.db.orm, wallet.id);
  });

  test("P1-2: currency mismatch rejects in the wallet currency and replays identically", async () => {
    const wallet = await openWallet(app, "100.00");
    const body = betBody({ playerId: wallet.playerId, walletId: wallet.id, money: { amount: "10.00", currency: "USD" } });

    const response = await submit(app, body);
    expect(response.status).toBe(422);
    const first = await json(response);
    expect(first.failureCode).toBe("CURRENCY_MISMATCH");
    // O saldo observado é o da wallet (BRL), nunca a moeda da aposta (USD).
    expect(first.balance).toEqual({ amount: "100.00", currency: "BRL" });

    const replay = await submit(app, body);
    expect(replay.status).toBe(422);
    const replayed = await json(replay);
    expect(replayed.idempotentReplay).toBe(true);
    expect(replayed.balance).toEqual({ amount: "100.00", currency: "BRL" });

    // E a consulta da transação também devolve o saldo em BRL.
    const read = await app.request(`/wagering/transactions/${first.transactionId}`);
    const view = (await read.json()) as { resultBalance: { amount: string; currency: string } };
    expect(view.resultBalance).toEqual({ amount: "100.00", currency: "BRL" });
    await assertWalletConsistent(app.db.orm, wallet.id);
  });

  test("wrong player for an existing wallet is WALLET_PLAYER_MISMATCH", async () => {
    const wallet = await openWallet(app, "100.00");
    const body = betBody({ playerId: crypto.randomUUID(), walletId: wallet.id });
    const response = await submit(app, body);
    expect(response.status).toBe(422);
    expect((await json(response)).failureCode).toBe("WALLET_PLAYER_MISMATCH");
    await assertWalletConsistent(app.db.orm, wallet.id);
  });

  test("I5: unknown wallet is persisted as WALLET_NOT_FOUND and replays stably (ADR-002)", async () => {
    const missingWalletId = crypto.randomUUID();
    const body = betBody({ playerId: crypto.randomUUID(), walletId: missingWalletId });
    const first = await submit(app, body);
    expect(first.status).toBe(422);
    const firstBody = await json(first);
    expect(firstBody.failureCode).toBe("WALLET_NOT_FOUND");
    expect(firstBody.balance).toBeNull();

    const replay = await submit(app, body);
    expect(replay.status).toBe(422);
    const replayBody = await json(replay);
    expect(replayBody.idempotentReplay).toBe(true);
    expect(replayBody.transactionId).toBe(firstBody.transactionId);
  });

  test("P2-3: zero and bad-scale amounts are 400 INVALID_PAYLOAD, not 500", async () => {
    const wallet = await openWallet(app, "100.00");
    for (const amount of ["0.00", "1", "25.5", "25.001"]) {
      const response = await submit(app, betBody({ playerId: wallet.playerId, walletId: wallet.id, money: { amount, currency: "BRL" } }));
      expect(response.status).toBe(400);
      expect((await response.json() as { code: string }).code).toBe("INVALID_PAYLOAD");
    }
    await assertWalletConsistent(app.db.orm, wallet.id);
  });

  test("P2-4: a duplicate (provider, external) with a new key on a missing wallet is 409, not 500", async () => {
    const wallet = await openWallet(app, "100.00");
    const external = crypto.randomUUID();
    const body = betBody({ playerId: wallet.playerId, walletId: wallet.id, externalTransactionId: external });
    expect((await submit(app, body, `key-a-${external}`)).status).toBe(201);

    // Mesmo (provider, external), key diferente, walletId inexistente → conflito de duplicidade.
    const resend = betBody({ playerId: crypto.randomUUID(), walletId: crypto.randomUUID(), externalTransactionId: external });
    const response = await submit(app, resend, `key-b-${external}`);
    expect(response.status).toBe(409);
    expect((await response.json() as { code: string }).code).toBe("DUPLICATE_EXTERNAL_TRANSACTION");
    await assertWalletConsistent(app.db.orm, wallet.id);
  });

  test("GET endpoints return the stored transaction", async () => {
    const wallet = await openWallet(app, "100.00");
    const external = crypto.randomUUID();
    const created = await json(await submit(app, betBody({ playerId: wallet.playerId, walletId: wallet.id, externalTransactionId: external })));
    const byId = await app.request(`/wagering/transactions/${created.transactionId}`);
    expect(byId.status).toBe(200);
    const byExternal = await app.request(`/providers/provider-a/wagering/transactions/${external}`);
    expect(byExternal.status).toBe(200);
  });
});
