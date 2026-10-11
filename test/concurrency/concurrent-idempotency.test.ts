import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { assertWalletConsistent } from "../support/consistency";
import { createTestDatabase, type TestDatabase } from "../support/database";
import { CONSUMER_NAME } from "../../src/wagering/infra/sqs/wager-consumer.worker";
import { WagerKind } from "../../src/wagering/domain/wager-kind";
import { type SubmitCommand, type SubmitWagerTransaction } from "../../src/wagering/application/submit-wager-transaction";
import { type OpenWallet } from "../../src/wallet/application/open-wallet";
import { buildUseCases } from "../support/use-cases";

let db: TestDatabase;
let submit: SubmitWagerTransaction;
let openWallet: OpenWallet;

beforeAll(async () => {
  db = await createTestDatabase();
  ({ submit, openWallet } = buildUseCases(db.orm));
});

afterAll(async () => {
  await db.close();
});

const inboxCount = async (messageId: string): Promise<number> => {
  const rows = await db.orm.em
    .getConnection()
    .execute<{ c: number }[]>("SELECT count(*)::int AS c FROM inbox_messages WHERE message_id = ?", [messageId]);
  return rows[0]?.c ?? 0;
};

function command(walletId: string, playerId: string, messageId: string): SubmitCommand {
  return {
    providerId: "provider-a",
    externalTransactionId: "shared-external",
    playerId,
    walletId,
    roundId: "round-1",
    gameId: "game-1",
    kind: WagerKind.Bet,
    money: { amount: "20.00", currency: "BRL" },
    referenceExternalTransactionId: null,
    idempotencyKey: "provider-a:shared-external",
    correlationId: "c",
    causationId: messageId,
    source: { type: "sqs", messageId, consumerName: CONSUMER_NAME },
  };
}

describe("C — concurrent idempotency conflict via SQS preserves both inbox records", () => {
  test("two messages with the same key racing the INSERT: one wins, the loser still records its inbox", async () => {
    const a = await openWallet.execute({ playerId: crypto.randomUUID(), initialBalance: { amount: "100.00", currency: "BRL" }, correlationId: "c" });
    const b = await openWallet.execute({ playerId: crypto.randomUUID(), initialBalance: { amount: "100.00", currency: "BRL" }, correlationId: "c" });

    // Mesma idempotency key + mesmo (provider, external), wallets distintas → corrida no INSERT.
    const [r1, r2] = await Promise.all([
      submit.execute(command(a.id, a.playerId, "msg-1")),
      submit.execute(command(b.id, b.playerId, "msg-2")),
    ]);

    // Um venceu (PROCESSED), o outro é conflito resolvido (não exceção perdida).
    const processed = [r1, r2].filter((r) => !r.conflict && r.status === "PROCESSED");
    const conflicts = [r1, r2].filter((r) => r.conflict);
    expect(processed.length).toBe(1);
    expect(conflicts.length).toBe(1);

    // AMBOS os messageIds ficaram registrados na inbox (o do perdedor não foi perdido no rollback).
    expect(await inboxCount("msg-1")).toBe(1);
    expect(await inboxCount("msg-2")).toBe(1);

    // Exatamente uma wallet foi debitada.
    const balances = await db.orm.em
      .getConnection()
      .execute<{ balance_amount: string }[]>("SELECT balance_amount FROM wallets WHERE id IN (?, ?) ORDER BY balance_amount", [a.id, b.id]);
    expect(balances.map((row) => row.balance_amount)).toEqual(["80.00", "100.00"]);

    // E o messageId do perdedor não pode ser reusado com outro payload (inbox detecta o conflito).
    const loserMessageId = conflicts.length === 1 ? (processed[0] === r1 ? "msg-2" : "msg-1") : "msg-2";
    let reusedRejected = false;
    try {
      await submit.execute({ ...command(a.id, a.playerId, loserMessageId), money: { amount: "30.00", currency: "BRL" }, idempotencyKey: "provider-a:another" });
    } catch {
      reusedRejected = true; // InboxPayloadConflictError
    }
    expect(reusedRejected).toBe(true);

    // Invariante final (§13): o saldo reconstruído pelo ledger bate em ambas as wallets.
    await assertWalletConsistent(db.orm, a.id);
    await assertWalletConsistent(db.orm, b.id);
  });
});
