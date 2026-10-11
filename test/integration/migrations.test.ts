import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDatabase, type TestDatabase } from "../support/database";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase(); // já roda migrator.up()
});

afterAll(async () => {
  await db.close();
});

const tableCount = async (): Promise<number> => {
  const rows = await db.orm.em.getConnection().execute<{ c: number }[]>(
    `SELECT count(*)::int AS c FROM information_schema.tables WHERE table_schema='public'
       AND table_name IN ('wallets','wager_transactions','wallet_ledger_entries','inbox_messages','outbox_messages')`,
  );
  return rows[0]?.c ?? 0;
};

describe("I1 — migrations up → down → up (spec §12)", () => {
  test("down removes the schema and up recreates it, reversibly", async () => {
    const migrator = db.orm.getMigrator();

    expect(await tableCount()).toBe(5);

    await migrator.down({ to: 0 });
    expect(await tableCount()).toBe(0);

    await migrator.up();
    expect(await tableCount()).toBe(5);

    // Segunda volta, para garantir que down→up é idempotente.
    await migrator.down({ to: 0 });
    await migrator.up();
    expect(await tableCount()).toBe(5);
  });
});
