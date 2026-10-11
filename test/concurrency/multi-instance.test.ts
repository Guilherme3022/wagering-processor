import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eventually } from "../support/async";
import { assertWalletConsistent } from "../support/consistency";
import { type Infra, type Instance, provisionInfra, spawnInstance } from "../support/cluster";
import { betBody, openWallet, submit } from "../support/wager";

let infra: Infra;
let instances: Instance[];

beforeAll(async () => {
  infra = await provisionInfra();
  instances = [3140, 3141, 3142].map((port) => spawnInstance(infra, port));
  await Promise.all(instances.map((i) => i.waitReady()));
}, 60000);

afterAll(async () => {
  for (const instance of instances) {
    instance.kill("SIGKILL");
  }
  await Promise.all(instances.map((i) => i.waitExit()));
  await infra.close();
}, 30000);

function sendBet(walletId: string, playerId: string, amount: string, external: string): Promise<void> {
  const body = JSON.stringify({
    messageId: crypto.randomUUID(),
    type: "WagerTransactionRequested",
    occurredAt: new Date().toISOString(),
    data: {
      providerId: "provider-a",
      externalTransactionId: external,
      playerId,
      walletId,
      roundId: "round-1",
      gameId: "game-1",
      kind: "BET",
      money: { amount, currency: "BRL" },
      idempotencyKey: `provider-a:${external}`,
    },
  });
  return infra.sqs.sendOne(infra.inputQueue, { id: external, body, groupId: walletId, deduplicationId: external });
}

describe("C4 — three instances over the same wallets (HTTP + consumer)", () => {
  test("12 HTTP bets + 6 SQS bets per wallet across 3 instances stay consistent", async () => {
    const wallets = await Promise.all(Array.from({ length: 4 }, () => openWallet(instances[0]!, "1000.00")));

    const httpRequests = wallets.flatMap((wallet) =>
      Array.from({ length: 12 }, (_unused, index) => {
        const instance = instances[index % instances.length]!;
        return submit(
          instance,
          betBody({ playerId: wallet.playerId, walletId: wallet.id, money: { amount: "1.00", currency: "BRL" } }),
        );
      }),
    );
    const httpResponses = await Promise.all(httpRequests);
    expect(httpResponses.every((r) => r.status === 201)).toBe(true);

    await Promise.all(
      wallets.flatMap((wallet) =>
        Array.from({ length: 6 }, () => sendBet(wallet.id, wallet.playerId, "1.00", crypto.randomUUID())),
      ),
    );

    for (const wallet of wallets) {
      await eventually(
        async () => {
          const read = await instances[0]!.request(`/wallets/${wallet.id}`);
          const balance = ((await read.json()) as { balance: { amount: string } }).balance.amount;
          expect(balance).toBe("982.00");
        },
        { timeoutMs: 20000, intervalMs: 200 },
      );
      await assertWalletConsistent(infra.db.orm, wallet.id);
    }
  }, 60000);
});
