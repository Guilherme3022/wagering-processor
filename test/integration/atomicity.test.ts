import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadConfig } from "../../src/shared/infra/config/app-config";
import { processedEvent } from "../../src/shared/application/event-factory";
import { Database } from "../../src/shared/infra/persistence/database";
import { SqlUnitOfWork } from "../../src/shared/infra/persistence/sql-unit-of-work";
import { Money } from "../../src/shared/domain/money";
import { createOpeningTransaction, openingHashPayload } from "../../src/wagering/domain/opening-transaction";
import { PayloadHasher } from "../../src/wagering/domain/payload-hasher";
import { Wallet } from "../../src/wallet/domain/wallet";
import { createTestDatabase, type TestDatabase } from "../support/database";
import { TEST_DATABASE_URL } from "../support/env";

let db: TestDatabase;
let uow: SqlUnitOfWork;

beforeAll(async () => {
  db = await createTestDatabase();
  const config = loadConfig({ ...process.env, DATABASE_URL: TEST_DATABASE_URL });
  uow = new SqlUnitOfWork(new Database(db.orm), config);
});

afterAll(async () => {
  await db.close();
});

const count = async (table: string): Promise<number> => {
  const rows = await db.orm.em.getConnection().execute<{ c: number }[]>(`SELECT count(*)::int AS c FROM ${table}`);
  return rows[0]?.c ?? 0;
};

/** Erro sentinela: a falha planejada, para distinguir de erros acidentais (ex.: FK). */
class Boom extends Error {}

describe("I2 — atomicity (spec §12)", () => {
  test("a failure after all writes, before commit, leaves nothing in any table", async () => {
    const at = new Date();
    const walletId = crypto.randomUUID();
    const openingTransactionId = crypto.randomUUID();
    const { wallet, openingEntry } = Wallet.open({
      id: walletId,
      playerId: crypto.randomUUID(),
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      openingTransactionId,
      openingEntryId: crypto.randomUUID(),
      at,
    });
    expect(openingEntry).toBeDefined();
    const hasher = new PayloadHasher();

    let caught: unknown;
    try {
      await uow.transaction(async (ports) => {
        // Grava TUDO (inbox incluída, como numa entrada SQS) e só então falha.
        await ports.inbox.register("consumer-x", "msg-atomicity", "v1:h", at);
        await ports.wallets.insert(wallet);
        const tx = createOpeningTransaction({
          id: openingTransactionId, // mesmo id que o lançamento referencia (sem FK acidental)
          walletId,
          playerId: wallet.playerId,
          money: wallet.balance,
          payloadHash: hasher.hash(openingHashPayload({ walletId, playerId: wallet.playerId, money: wallet.balance })),
          correlationId: "corr-1",
          at,
        });
        await ports.transactions.insert(tx);
        await ports.ledger.insert(openingEntry as NonNullable<typeof openingEntry>);
        await ports.outbox.enqueue(processedEvent({ tx, eventId: crypto.randomUUID(), causationId: tx.id }), at);
        throw new Boom("falha forçada após todas as gravações");
      });
    } catch (error) {
      caught = error;
    }

    // A exceção é exatamente a planejada — a transação chegou até o fim antes do rollback.
    expect(caught).toBeInstanceOf(Boom);
    expect(await count("wallets")).toBe(0);
    expect(await count("wager_transactions")).toBe(0);
    expect(await count("wallet_ledger_entries")).toBe(0);
    expect(await count("outbox_messages")).toBe(0);
    expect(await count("inbox_messages")).toBe(0);
  });
});
