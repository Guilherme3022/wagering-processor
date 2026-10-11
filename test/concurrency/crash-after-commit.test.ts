import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eventually } from "../support/async";
import { assertWalletConsistent } from "../support/consistency";
import { type Infra, type Instance, provisionInfra, spawnInstance } from "../support/cluster";
import { openWallet } from "../support/wager";

let infra: Infra;
let faulty: Instance;
let healthy: Instance;

beforeAll(async () => {
  infra = await provisionInfra();
}, 60000);

afterAll(async () => {
  healthy?.kill("SIGKILL");
  await healthy?.waitExit();
  await infra.close();
}, 30000);

describe("C5 — crash after commit, before ack (fault injection)", () => {
  test("redelivery after a crash does not duplicate the effect", async () => {
    faulty = spawnInstance(infra, 3150, { FAULT_INJECTION: "exit_after_commit_before_ack" });
    await faulty.waitReady();

    const wallet = await openWallet(faulty, "100.00");
    const external = crypto.randomUUID();
    const body = JSON.stringify({
      messageId: crypto.randomUUID(),
      type: "WagerTransactionRequested",
      occurredAt: new Date().toISOString(),
      data: {
        providerId: "provider-a",
        externalTransactionId: external,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "round-1",
        gameId: "game-1",
        kind: "BET",
        money: { amount: "25.00", currency: "BRL" },
        idempotencyKey: `provider-a:${external}`,
      },
    });
    await infra.sqs.sendOne(infra.inputQueue, { id: external, body, groupId: wallet.id, deduplicationId: external });

    // A instância comita e cai (exit 137) antes de confirmar a mensagem.
    const exitCode = await faulty.waitExit();
    expect(exitCode).not.toBe(0);

    // Outra instância assume a redelivery; a inbox impede o reprocessamento.
    healthy = spawnInstance(infra, 3151);
    await healthy.waitReady();

    await eventually(
      async () => {
        const read = await healthy.request(`/wallets/${wallet.id}`);
        const balance = ((await read.json()) as { balance: { amount: string } }).balance.amount;
        expect(balance).toBe("75.00");
      },
      { timeoutMs: 20000, intervalMs: 200 },
    );
    await assertWalletConsistent(infra.db.orm, wallet.id);
  }, 60000);
});
