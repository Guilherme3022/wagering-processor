import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startTestApp, type TestApp } from "../support/app";
import { assertWalletConsistent } from "../support/consistency";
import { FakeClock } from "../support/time";
import { betBody, openWallet, submit, type SubmitResponse } from "../support/wager";
import { referenceWorker } from "../support/worker";

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.close();
});

const json = async (res: Response): Promise<SubmitResponse> => (await res.json()) as SubmitResponse;

describe("C7 — references arriving out of order (ADR-004, ADR-001)", () => {
  test("REFUND before its BET goes PENDING_REFERENCE and resolves when the BET arrives", async () => {
    const wallet = await openWallet(app, "100.00");
    const ns = crypto.randomUUID();
    const base = { playerId: wallet.playerId, walletId: wallet.id };

    const refund = await submit(
      app,
      betBody({ ...base, kind: "REFUND", externalTransactionId: `${ns}-refund`, money: { amount: "30.00", currency: "BRL" }, referenceExternalTransactionId: `${ns}-bet` }),
    );
    expect(refund.status).toBe(202);
    expect((await json(refund)).status).toBe("PENDING_REFERENCE");

    const bet = await submit(
      app,
      betBody({ ...base, kind: "BET", externalTransactionId: `${ns}-bet`, money: { amount: "30.00", currency: "BRL" } }),
    );
    expect(bet.status).toBe(201);

    const worker = referenceWorker(app.db.orm, new FakeClock(new Date(Date.now() + 60_000)));
    await worker.tick();

    const resolved = await app.request(`/providers/provider-a/wagering/transactions/${ns}-refund`);
    expect(((await resolved.json()) as { status: string }).status).toBe("PROCESSED");
    const read = await app.request(`/wallets/${wallet.id}`);
    expect(((await read.json()) as { balance: { amount: string } }).balance.amount).toBe("100.00");
    await assertWalletConsistent(app.db.orm, wallet.id);
  });

  test("a reference that never arrives is REFERENCE_NOT_FOUND after the deadline (FakeClock)", async () => {
    const wallet = await openWallet(app, "100.00");
    const ns = crypto.randomUUID();
    const refund = await submit(
      app,
      betBody({ playerId: wallet.playerId, walletId: wallet.id, kind: "REFUND", externalTransactionId: `${ns}-refund`, money: { amount: "30.00", currency: "BRL" }, referenceExternalTransactionId: `${ns}-missing` }),
    );
    expect(refund.status).toBe(202);

    // Avança o relógio do worker além do prazo de 24h.
    const worker = referenceWorker(app.db.orm, new FakeClock(new Date(Date.now() + 25 * 60 * 60 * 1000)));
    await worker.tick();

    const rejected = await app.request(`/providers/provider-a/wagering/transactions/${ns}-refund`);
    const body = (await rejected.json()) as { status: string; failureCode: string };
    expect(body.status).toBe("REJECTED");
    expect(body.failureCode).toBe("REFERENCE_NOT_FOUND");
    await assertWalletConsistent(app.db.orm, wallet.id);
  });

  test("concurrent REFUND and ROLLBACK on the same BET credit only once (ADR-001)", async () => {
    const wallet = await openWallet(app, "100.00");
    const ns = crypto.randomUUID();
    const base = { playerId: wallet.playerId, walletId: wallet.id };
    await submit(app, betBody({ ...base, kind: "BET", externalTransactionId: `${ns}-bet`, money: { amount: "30.00", currency: "BRL" } }));

    const [refund, rollback] = await Promise.all([
      submit(app, betBody({ ...base, kind: "REFUND", externalTransactionId: `${ns}-refund`, money: { amount: "30.00", currency: "BRL" }, referenceExternalTransactionId: `${ns}-bet` })),
      submit(app, betBody({ ...base, kind: "ROLLBACK", externalTransactionId: `${ns}-rollback`, money: { amount: "30.00", currency: "BRL" }, referenceExternalTransactionId: `${ns}-bet` })),
    ]);

    const statuses = [refund.status, rollback.status].sort();
    expect(statuses).toEqual([201, 422]);
    const bodies = (await Promise.all([refund.json(), rollback.json()])) as SubmitResponse[];
    expect(bodies.find((b) => b.status === "REJECTED")?.failureCode).toBe("REFERENCE_ALREADY_REVERSED");

    const read = await app.request(`/wallets/${wallet.id}`);
    expect(((await read.json()) as { balance: { amount: string } }).balance.amount).toBe("100.00");
    await assertWalletConsistent(app.db.orm, wallet.id);
  });
});
