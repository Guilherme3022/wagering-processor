import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eventually } from "../support/async";
import { assertWalletConsistent } from "../support/consistency";
import { enqueueBet, type Infra, type Instance, provisionInfra, spawnInstance } from "../support/cluster";
import { PG_CONTAINER, pauseContainer, unpauseContainer } from "../support/chaos";
import { openWallet } from "../support/wager";

let infra: Infra;
let instance: Instance;

beforeAll(async () => {
  infra = await provisionInfra();
  instance = spawnInstance(infra, 3190);
  await instance.waitReady();
}, 60000);

afterAll(async () => {
  await unpauseContainer(PG_CONTAINER); // destrava mesmo em falha
  instance?.kill("SIGKILL");
  await instance?.waitExit();
  await infra.close();
}, 30000);

describe("I10 — PostgreSQL unavailable (spec §12, docker pause)", () => {
  test("reads fail during the outage; queued messages are processed once after recovery", async () => {
    const wallet = await openWallet(instance, "100.00");
    for (let i = 0; i < 5; i += 1) {
      await enqueueBet(infra, { walletId: wallet.id, playerId: wallet.playerId, amount: "1.00", external: crypto.randomUUID() });
    }

    await pauseContainer(PG_CONTAINER);
    let readFailed: boolean;
    try {
      // Leitura durante a queda: não pode devolver um 2xx falso. Abortamos em 2s.
      const response = await instance.request(`/wallets/${wallet.id}`, { signal: AbortSignal.timeout(2000) });
      readFailed = response.status >= 500;
    } catch {
      readFailed = true; // abort/erro de conexão — nunca sucesso falso
    } finally {
      await unpauseContainer(PG_CONTAINER);
    }
    expect(readFailed).toBe(true);

    // Após o unpause, as mensagens que voltaram por visibilidade são processadas exatamente uma vez.
    await eventually(
      async () => {
        const read = await instance.request(`/wallets/${wallet.id}`);
        const balance = ((await read.json()) as { balance: { amount: string } }).balance.amount;
        expect(balance).toBe("95.00");
      },
      { timeoutMs: 30000, intervalMs: 300 },
    );
    await assertWalletConsistent(infra.db.orm, wallet.id);
  }, 90000);
});
