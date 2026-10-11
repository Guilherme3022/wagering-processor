import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { postJson, startTestApp, type TestApp } from "../support/app";
import { assertWalletConsistent } from "../support/consistency";

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.close();
});

const createWallet = (playerId: string, amount: string): Promise<Response> =>
  app.request("/wallets", postJson({ playerId, initialBalance: { amount, currency: "BRL" } }));

describe("wallet endpoints (spec §6.3, §7.2)", () => {
  test("opens a wallet with a positive balance and an OPENING ledger entry", async () => {
    const playerId = crypto.randomUUID();
    const response = await createWallet(playerId, "1000.00");
    expect(response.status).toBe(201);
    const wallet = (await response.json()) as { id: string; balance: { amount: string }; version: number };
    expect(wallet.balance.amount).toBe("1000.00");
    expect(wallet.version).toBe(1);

    const read = await app.request(`/wallets/${wallet.id}`);
    expect(read.status).toBe(200);

    const ledger = await app.request(`/wallets/${wallet.id}/ledger`);
    const page = (await ledger.json()) as { items: unknown[]; nextCursor: string | null };
    expect(page.items.length).toBe(1);
    expect(page.nextCursor).toBeNull();

    const reconciliation = await app.request(`/wallets/${wallet.id}/reconciliation`, { method: "POST" });
    const recon = (await reconciliation.json()) as { consistent: boolean };
    expect(recon.consistent).toBe(true);

    await assertWalletConsistent(app.db.orm, wallet.id);
  });

  test("opens a zero-balance wallet with no ledger entry", async () => {
    const response = await createWallet(crypto.randomUUID(), "0.00");
    expect(response.status).toBe(201);
    const wallet = (await response.json()) as { id: string; version: number };
    expect(wallet.version).toBe(1);

    const ledger = await app.request(`/wallets/${wallet.id}/ledger`);
    const page = (await ledger.json()) as { items: unknown[] };
    expect(page.items.length).toBe(0);
    await assertWalletConsistent(app.db.orm, wallet.id);
  });

  test("rejects a duplicate (player, currency) with 409", async () => {
    const playerId = crypto.randomUUID();
    expect((await createWallet(playerId, "10.00")).status).toBe(201);
    const duplicate = await createWallet(playerId, "20.00");
    expect(duplicate.status).toBe(409);
    const problem = (await duplicate.json()) as { code: string };
    expect(problem.code).toBe("WALLET_ALREADY_EXISTS");
  });

  test("rejects an amount without exactly two decimals (ADR-003)", async () => {
    const response = await createWallet(crypto.randomUUID(), "1000");
    expect(response.status).toBe(400);
    const problem = (await response.json()) as { code: string };
    expect(problem.code).toBe("INVALID_PAYLOAD");
  });

  test("returns 404 for an unknown wallet", async () => {
    const response = await app.request(`/wallets/${crypto.randomUUID()}`);
    expect(response.status).toBe(404);
  });

  test("P2-3: a non-UUID walletId in the route is 400, not 500", async () => {
    const response = await app.request(`/wallets/not-a-uuid`);
    expect(response.status).toBe(400);
    expect((await response.json() as { code: string }).code).toBe("INVALID_PAYLOAD");
  });

  test("rejects a malformed ledger cursor with 400", async () => {
    const created = await createWallet(crypto.randomUUID(), "5.00");
    const wallet = (await created.json()) as { id: string };
    const response = await app.request(`/wallets/${wallet.id}/ledger?cursor=not-a-cursor`);
    expect(response.status).toBe(400);
  });

  test("echoes back the provided correlation id", async () => {
    const response = await app.request("/health/live", {
      headers: { "x-correlation-id": "corr-test-123" },
    });
    expect(response.headers.get("x-correlation-id")).toBe("corr-test-123");
  });
});
