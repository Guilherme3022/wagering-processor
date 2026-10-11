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

interface Ctx {
  playerId: string;
  walletId: string;
  ns: string;
}

async function ctx(amount: string): Promise<Ctx> {
  const wallet = await openWallet(app, amount);
  return { playerId: wallet.playerId, walletId: wallet.id, ns: crypto.randomUUID() };
}

const ext = (c: Ctx, name: string): string => `${c.ns}-${name}`;

async function bet(c: Ctx, amount: string, name: string): Promise<SubmitResponse> {
  return json(
    await submit(app, betBody({ playerId: c.playerId, walletId: c.walletId, kind: "BET", externalTransactionId: ext(c, name), money: { amount, currency: "BRL" } })),
  );
}

async function win(c: Ctx, amount: string, name: string): Promise<void> {
  await submit(app, betBody({ playerId: c.playerId, walletId: c.walletId, kind: "WIN", externalTransactionId: ext(c, name), money: { amount, currency: "BRL" } }));
}

function compensate(
  c: Ctx,
  kind: "REFUND" | "ROLLBACK",
  amount: string,
  name: string,
  referenceName: string,
  roundId = "round-1",
): Promise<Response> {
  return submit(
    app,
    betBody({ playerId: c.playerId, walletId: c.walletId, kind, externalTransactionId: ext(c, name), roundId, money: { amount, currency: "BRL" }, referenceExternalTransactionId: ext(c, referenceName) }),
  );
}

describe("I4 — reference rules (spec §3.4, ADR-001)", () => {
  test("REFUND of a BET credits back; a second compensation is REFERENCE_ALREADY_REVERSED", async () => {
    const c = await ctx("100.00");
    await bet(c, "30.00", "bet");
    const refund = await compensate(c, "REFUND", "30.00", "refund", "bet");
    expect(refund.status).toBe(201);
    expect((await json(refund)).balance?.amount).toBe("100.00");

    const second = await compensate(c, "REFUND", "30.00", "refund2", "bet");
    expect(second.status).toBe(422);
    expect((await json(second)).failureCode).toBe("REFERENCE_ALREADY_REVERSED");

    const rollback = await compensate(c, "ROLLBACK", "30.00", "rollback", "bet");
    expect((await json(rollback)).failureCode).toBe("REFERENCE_ALREADY_REVERSED");

    await assertWalletConsistent(app.db.orm, c.walletId);
  });

  test("ROLLBACK of a REFUND debits; a second ROLLBACK of it is rejected", async () => {
    const c = await ctx("100.00");
    await bet(c, "30.00", "bet");
    expect((await compensate(c, "REFUND", "30.00", "refund", "bet")).status).toBe(201);
    const rollback = await compensate(c, "ROLLBACK", "30.00", "rollback", "refund");
    expect(rollback.status).toBe(201);
    expect((await json(rollback)).balance?.amount).toBe("70.00");

    const second = await compensate(c, "ROLLBACK", "30.00", "rollback2", "refund");
    expect((await json(second)).failureCode).toBe("REFERENCE_ALREADY_REVERSED");

    await assertWalletConsistent(app.db.orm, c.walletId);
  });

  test("AMOUNT_MISMATCH when the refund amount differs", async () => {
    const c = await ctx("100.00");
    await bet(c, "30.00", "bet");
    expect((await json(await compensate(c, "REFUND", "20.00", "refund", "bet"))).failureCode).toBe("AMOUNT_MISMATCH");
  });

  test("INVALID_REFERENCE_KIND when REFUND points at a WIN", async () => {
    const c = await ctx("100.00");
    await win(c, "10.00", "win");
    expect((await json(await compensate(c, "REFUND", "10.00", "refund", "win"))).failureCode).toBe("INVALID_REFERENCE_KIND");
  });

  test("REFERENCE_MISMATCH when the round differs", async () => {
    const c = await ctx("100.00");
    await bet(c, "30.00", "bet");
    expect((await json(await compensate(c, "REFUND", "30.00", "refund", "bet", "round-99"))).failureCode).toBe("REFERENCE_MISMATCH");
  });

  test("REFERENCE_NOT_PROCESSED when the reference was rejected", async () => {
    const c = await ctx("10.00");
    expect((await bet(c, "50.00", "bet")).failureCode).toBe("INSUFFICIENT_FUNDS");
    expect((await json(await compensate(c, "REFUND", "50.00", "refund", "bet"))).failureCode).toBe("REFERENCE_NOT_PROCESSED");
  });

  test("ROLLBACK of a WIN with no funds is REVERSAL_INSUFFICIENT_FUNDS", async () => {
    const c = await ctx("0.00");
    await win(c, "50.00", "win");
    await bet(c, "50.00", "bet");
    expect((await json(await compensate(c, "ROLLBACK", "50.00", "rollback", "win"))).failureCode).toBe("REVERSAL_INSUFFICIENT_FUNDS");
  });

  test("ADR-001 #4: the partial unique index blocks a second PROCESSED compensation via direct SQL", async () => {
    const c = await ctx("100.00");
    const betResponse = await bet(c, "30.00", "bet");
    const connection = app.db.orm.em.getConnection();
    const insertCompensation = (name: string): Promise<unknown> =>
      connection.execute(
        `INSERT INTO wager_transactions (id, provider_id, external_transaction_id, idempotency_key,
          payload_hash, requested_wallet_id, wallet_id, player_id, round_id, game_id, kind, amount,
          currency, reference_external_transaction_id, reference_transaction_id, status,
          result_balance_amount, result_balance_currency, correlation_id, created_at, processed_at)
         VALUES (?, 'provider-a', ?, ?, 'v1:h', ?, ?, ?, 'round-1', 'game-1', 'REFUND', '30.00',
          'BRL', ?, ?, 'PROCESSED', '100.00', 'BRL', 'c', now(), now())`,
        [crypto.randomUUID(), ext(c, name), `k-${ext(c, name)}`, c.walletId, c.walletId, c.playerId, ext(c, "bet"), betResponse.transactionId],
      );
    await insertCompensation("direct1");
    let threw = false;
    try {
      await insertCompensation("direct2");
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
