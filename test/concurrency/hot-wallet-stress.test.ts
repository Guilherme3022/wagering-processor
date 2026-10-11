import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { assertWalletConsistent } from "../support/consistency";
import { MoneyAmountType } from "../../src/shared/infra/persistence/money-amount.type";
import { type Infra, type Instance, provisionInfra, spawnInstance } from "../support/cluster";
import { betBody, openWallet, submit } from "../support/wager";

let infra: Infra;
let instances: Instance[];

beforeAll(async () => {
  infra = await provisionInfra();
  instances = [3180, 3181, 3182].map((port) => spawnInstance(infra, port));
  await Promise.all(instances.map((i) => i.waitReady()));
}, 60000);

afterAll(async () => {
  for (const instance of instances) {
    instance.kill("SIGKILL");
  }
  await Promise.all(instances.map((i) => i.waitExit()));
  await infra.close();
}, 30000);

interface Op {
  external: string;
  kind: "BET" | "WIN" | "LOSS";
}

async function scalar(sql: string, params: unknown[]): Promise<number> {
  const rows = await infra.db.orm.em.getConnection().execute<{ c: number }[]>(sql, params);
  return rows[0]?.c ?? 0;
}

describe("C9 — hot wallet stress (300 mixed ops across 3 instances)", () => {
  test("no negative balance, no duplicates, continuous chain", async () => {
    const wallet = await openWallet(instances[0]!, "100000.00");

    const distinct: Op[] = Array.from({ length: 270 }, (_u, i) => ({
      external: crypto.randomUUID(),
      kind: i % 10 < 6 ? "BET" : i % 10 < 8 ? "WIN" : "LOSS",
    }));
    const duplicates = Array.from({ length: 30 }, (_u, i) => distinct[i * 9 % distinct.length]!);
    const all: Op[] = [...distinct, ...duplicates];

    const responses = await Promise.all(
      all.map((op, index) => {
        const instance = instances[index % instances.length]!;
        return submit(
          instance,
          betBody({ playerId: wallet.playerId, walletId: wallet.id, kind: op.kind, externalTransactionId: op.external, money: { amount: "1.00", currency: "BRL" } }),
        );
      }),
    );
    expect(responses.every((r) => r.status === 200 || r.status === 201)).toBe(true);

    const bets = distinct.filter((o) => o.kind === "BET").length;
    const wins = distinct.filter((o) => o.kind === "WIN").length;
    // Saldo esperado em centavos (bigint), nunca ponto flutuante (challenge §5.1 / AGENTS §2).
    const expectedCents = 10_000_000n - BigInt(bets) * 100n + BigInt(wins) * 100n;
    const expectedBalance = new MoneyAmountType().convertToDatabaseValue(expectedCents);

    const read = await instances[0]!.request(`/wallets/${wallet.id}`);
    expect(((await read.json()) as { balance: { amount: string } }).balance.amount).toBe(expectedBalance);

    // Transações: 270 distintas + OPENING; duplicatas não criam linha nova.
    expect(await scalar("SELECT count(*)::int AS c FROM wager_transactions WHERE wallet_id = ?", [wallet.id])).toBe(271);
    // Lançamentos: OPENING + cada BET/WIN (LOSS não lança).
    expect(await scalar("SELECT count(*)::int AS c FROM wallet_ledger_entries WHERE wallet_id = ?", [wallet.id])).toBe(1 + bets + wins);

    await assertWalletConsistent(infra.db.orm, wallet.id);
  }, 90000);
});
