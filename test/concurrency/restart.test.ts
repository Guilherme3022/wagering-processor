import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eventually } from "../support/async";
import { assertWalletConsistent } from "../support/consistency";
import { enqueueBet, type Infra, type Instance, provisionInfra, spawnInstance } from "../support/cluster";
import { openWallet } from "../support/wager";

let infra: Infra;
let live: Instance[] = [];

beforeAll(async () => {
  infra = await provisionInfra();
}, 60000);

afterAll(async () => {
  for (const instance of live) {
    instance.kill("SIGKILL");
  }
  await Promise.all(live.map((i) => i.waitExit()));
  await infra.close();
}, 30000);

async function pendingOutbox(): Promise<number> {
  const rows = await infra.db.orm.em
    .getConnection()
    .execute<{ c: number }[]>("SELECT count(*)::int AS c FROM outbox_messages WHERE published_at IS NULL");
  return rows[0]?.c ?? 0;
}

describe("C8 — kill all instances mid-load and restart", () => {
  test("every enqueued bet is processed exactly once and the outbox drains", async () => {
    const total = 40;
    const starter = spawnInstance(infra, 3170);
    await starter.waitReady();
    const wallet = await openWallet(starter, "1000.00");
    starter.kill("SIGKILL");
    await starter.waitExit();

    // Enfileira a carga (durável na fila) antes de qualquer consumidor assumir.
    for (let i = 0; i < total; i += 1) {
      await enqueueBet(infra, { walletId: wallet.id, playerId: wallet.playerId, amount: "1.00", external: crypto.randomUUID() });
    }

    // Duas instâncias começam a drenar; mata as duas no meio.
    let batch = [3171, 3172].map((port) => spawnInstance(infra, port));
    live = batch;
    await Promise.all(batch.map((i) => i.waitReady()));
    await new Promise((resolve) => setTimeout(resolve, 600));
    for (const instance of batch) {
      instance.kill("SIGKILL");
    }
    await Promise.all(batch.map((i) => i.waitExit()));

    // Sobe de novo e espera a consistência final.
    batch = [3173, 3174].map((port) => spawnInstance(infra, port));
    live = batch;
    await Promise.all(batch.map((i) => i.waitReady()));

    await eventually(
      async () => {
        const read = await batch[0]!.request(`/wallets/${wallet.id}`);
        const balance = ((await read.json()) as { balance: { amount: string } }).balance.amount;
        expect(balance).toBe("960.00");
      },
      { timeoutMs: 90000, intervalMs: 300 },
    );
    await eventually(
      async () => {
        expect(await pendingOutbox()).toBe(0);
      },
      { timeoutMs: 60000, intervalMs: 300 },
    );
    await assertWalletConsistent(infra.db.orm, wallet.id);
  }, 240000);
});
