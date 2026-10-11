import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eventually } from "../support/async";
import { assertWalletConsistent } from "../support/consistency";
import { enqueueBet, type Infra, type Instance, provisionInfra, spawnInstance } from "../support/cluster";
import { openWallet } from "../support/wager";

let infra: Infra;
let first: Instance;
let second: Instance;

beforeAll(async () => {
  infra = await provisionInfra();
}, 60000);

afterAll(async () => {
  second?.kill("SIGKILL");
  await second?.waitExit();
  await infra.close();
}, 30000);

describe("I9 — graceful shutdown with messages in flight (spec §6.6)", () => {
  test("SIGTERM mid-stream loses nothing: all messages end up processed once", async () => {
    first = spawnInstance(infra, 3160);
    await first.waitReady();

    const wallet = await openWallet(first, "1000.00");
    for (let i = 0; i < 20; i += 1) {
      await enqueueBet(infra, { walletId: wallet.id, playerId: wallet.playerId, amount: "1.00", external: crypto.randomUUID() });
    }

    // Deixa começar a consumir e manda SIGTERM no meio do voo.
    await new Promise((resolve) => setTimeout(resolve, 250));
    first.kill("SIGTERM");
    const exitCode = await first.waitExit();
    // Nest roda os shutdown hooks e re-emite o SIGTERM, saindo com 143 (128+15) ou 0.
    expect([0, 143]).toContain(exitCode);

    // Nova instância assume o que ficou visível de novo.
    second = spawnInstance(infra, 3161);
    await second.waitReady();

    await eventually(
      async () => {
        const read = await second.request(`/wallets/${wallet.id}`);
        const balance = ((await read.json()) as { balance: { amount: string } }).balance.amount;
        expect(balance).toBe("980.00");
      },
      { timeoutMs: 25000, intervalMs: 250 },
    );
    await assertWalletConsistent(infra.db.orm, wallet.id);
  }, 70000);
});
