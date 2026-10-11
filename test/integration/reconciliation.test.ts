import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startTestApp, type TestApp } from "../support/app";
import { openWallet } from "../support/wager";

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.close();
});

const reconcile = async (walletId: string): Promise<{ consistent: boolean; chainValid: boolean; difference: { amount: string } }> => {
  const response = await app.request(`/wallets/${walletId}/reconciliation`, { method: "POST" });
  return (await response.json()) as { consistent: boolean; chainValid: boolean; difference: { amount: string } };
};

describe("I8 — reconciliation (spec §7.2)", () => {
  test("a healthy wallet reconciles as consistent", async () => {
    const wallet = await openWallet(app, "250.00");
    const result = await reconcile(wallet.id);
    expect(result.consistent).toBe(true);
    expect(result.chainValid).toBe(true);
    expect(result.difference.amount).toBe("0.00");
  });

  test("a forced divergence is reported, never corrected", async () => {
    const wallet = await openWallet(app, "100.00");
    const connection = app.db.orm.em.getConnection();
    // Corrompe o saldo sem lançamento — só possível desligando os guardas, como um incidente real.
    await connection.execute(`ALTER TABLE wallets DISABLE TRIGGER trg_wallet_guard`);
    await connection.execute(`ALTER TABLE wallets DISABLE TRIGGER trg_wallet_ledger_consistency`);
    await connection.execute(`UPDATE wallets SET balance_amount = '200.00' WHERE id = ?`, [wallet.id]);
    await connection.execute(`ALTER TABLE wallets ENABLE TRIGGER trg_wallet_ledger_consistency`);
    await connection.execute(`ALTER TABLE wallets ENABLE TRIGGER trg_wallet_guard`);

    const result = await reconcile(wallet.id);
    expect(result.consistent).toBe(false);
    expect(result.difference.amount).toBe("100.00");

    // Nunca corrige: o saldo corrompido continua lá.
    const read = await app.request(`/wallets/${wallet.id}`);
    expect(((await read.json()) as { balance: { amount: string } }).balance.amount).toBe("200.00");
  });
});
