import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type MikroORM } from "@mikro-orm/postgresql";
import { SqlSession } from "../../src/shared/infra/persistence/sql-session";
import { createTestDatabase, type TestDatabase } from "../support/database";

let db: TestDatabase;
let orm: MikroORM;

beforeAll(async () => {
  db = await createTestDatabase();
  orm = db.orm;
});

afterAll(async () => {
  await db.close();
});

const exec = (sql: string, params: unknown[] = []): Promise<unknown> =>
  orm.em.getConnection().execute(sql, params);

/**
 * Insere uma wallet zerada na versão 1 (caso de exceção do trigger de consistência deferido:
 * saldo 0 e versão 1 não exigem lançamento). Serve só como linha de referência para os testes.
 */
async function seedWallet(): Promise<string> {
  const id = crypto.randomUUID();
  await exec(
    `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
     VALUES (?, ?, 'BRL', '0.00', 1, now(), now())`,
    [id, crypto.randomUUID()],
  );
  return id;
}

/** Semeia wallet + OPENING + lançamento consistentes numa transação (passa os triggers deferidos). */
async function seedConsistentWallet(balance: string): Promise<{ walletId: string; entryId: string }> {
  const walletId = crypto.randomUUID();
  const txId = crypto.randomUUID();
  const entryId = crypto.randomUUID();
  const playerId = crypto.randomUUID();
  await orm.em.transactional(async (em) => {
    const session = new SqlSession(em);
    await session.command(
      `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
       VALUES (?, ?, 'BRL', ?, 1, now(), now())`,
      [walletId, playerId, balance],
    );
    await session.command(
      `INSERT INTO wager_transactions (id, provider_id, external_transaction_id, idempotency_key,
        payload_hash, requested_wallet_id, wallet_id, player_id, kind, amount, currency, status,
        result_balance_amount, result_balance_currency, correlation_id, created_at, processed_at)
       VALUES (?, '__system__', ?, ?, 'v1:h', ?, ?, ?, 'OPENING', ?, 'BRL', 'PROCESSED', ?, 'BRL', 'c', now(), now())`,
      [txId, `opening:${walletId}`, `__system__:opening:${walletId}`, walletId, walletId, playerId, balance, balance],
    );
    await session.command(
      `INSERT INTO wallet_ledger_entries (id, wallet_id, transaction_id, direction, amount, currency,
        balance_before, balance_after, wallet_version, created_at)
       VALUES (?, ?, ?, 'CREDIT', ?, 'BRL', '0.00', ?, 1, now())`,
      [entryId, walletId, txId, balance, balance],
    );
  });
  return { walletId, entryId };
}

async function expectReject(sql: string, params: unknown[] = []): Promise<void> {
  let threw = false;
  try {
    await exec(sql, params);
  } catch {
    threw = true;
  }
  expect(threw).toBe(true);
}

describe("I1 — schema constraints and triggers fire via direct SQL (spec §4)", () => {
  test("migrations applied all tables", async () => {
    const rows = (await exec(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name IN
        ('wallets','wager_transactions','wallet_ledger_entries','inbox_messages','outbox_messages')`,
    )) as unknown[];
    expect(rows.length).toBe(5);
  });

  test("wallets: negative balance is rejected", async () => {
    await expectReject(
      `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
       VALUES (?, ?, 'BRL', '-1.00', 1, now(), now())`,
      [crypto.randomUUID(), crypto.randomUUID()],
    );
  });

  test("wallets: bad currency is rejected", async () => {
    await expectReject(
      `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
       VALUES (?, ?, 'brl', '1.00', 1, now(), now())`,
      [crypto.randomUUID(), crypto.randomUUID()],
    );
  });

  test("wallets: duplicate (player, currency) is rejected", async () => {
    const player = crypto.randomUUID();
    await exec(
      `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
       VALUES (?, ?, 'BRL', '0.00', 1, now(), now())`,
      [crypto.randomUUID(), player],
    );
    await expectReject(
      `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
       VALUES (?, ?, 'BRL', '0.00', 1, now(), now())`,
      [crypto.randomUUID(), player],
    );
  });

  test("wallets: delete is blocked by the guard trigger", async () => {
    const id = await seedWallet();
    await expectReject(`DELETE FROM wallets WHERE id = ?`, [id]);
  });

  test("wallets: changing immutable columns is blocked", async () => {
    const id = await seedWallet();
    await expectReject(`UPDATE wallets SET currency = 'USD' WHERE id = ?`, [id]);
  });

  test("wallets: balance change without version bump is blocked", async () => {
    const id = await seedWallet();
    await expectReject(`UPDATE wallets SET balance_amount = '20.00' WHERE id = ?`, [id]);
  });

  test("wager_transactions: REFUND without reference is rejected", async () => {
    await expectReject(
      `INSERT INTO wager_transactions (id, provider_id, external_transaction_id, idempotency_key,
        payload_hash, requested_wallet_id, player_id, round_id, game_id, kind, amount, currency,
        status, correlation_id, created_at, processed_at, wallet_id, result_balance_amount, result_balance_currency)
       VALUES (?, 'provider-a', 'ext-1', 'k1', 'v1:h', ?, ?, 'r', 'g', 'REFUND', '1.00', 'BRL',
        'PROCESSED', 'c', now(), now(), NULL, '1.00', 'BRL')`,
      [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()],
    );
  });

  test("wager_transactions: BET with reference is rejected", async () => {
    await expectReject(
      `INSERT INTO wager_transactions (id, provider_id, external_transaction_id, idempotency_key,
        payload_hash, requested_wallet_id, player_id, round_id, game_id, kind, amount, currency,
        reference_external_transaction_id, status, correlation_id, created_at, processed_at,
        wallet_id, result_balance_amount, result_balance_currency)
       VALUES (?, 'provider-a', 'ext-2', 'k2', 'v1:h', ?, ?, 'r', 'g', 'BET', '1.00', 'BRL',
        'ext-0', 'PROCESSED', 'c', now(), now(), ?, '1.00', 'BRL')`,
      [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()],
    );
  });

  test("wager_transactions: terminal state is immutable", async () => {
    const walletId = await seedWallet();
    const txId = crypto.randomUUID();
    await exec(
      `INSERT INTO wager_transactions (id, provider_id, external_transaction_id, idempotency_key,
        payload_hash, requested_wallet_id, wallet_id, player_id, round_id, game_id, kind, amount,
        currency, status, correlation_id, created_at, processed_at, result_balance_amount, result_balance_currency)
       VALUES (?, 'provider-a', 'ext-3', 'k3', 'v1:h', ?, ?, ?, 'r', 'g', 'BET', '1.00', 'BRL',
        'PROCESSED', 'c', now(), now(), '5.00', 'BRL')`,
      [txId, walletId, walletId, crypto.randomUUID()],
    );
    await expectReject(`UPDATE wager_transactions SET status = 'FAILED', failure_code = 'PROCESSING_FAILED' WHERE id = ?`, [txId]);
  });

  test("ledger: update and delete are blocked (append-only)", async () => {
    const { entryId } = await seedConsistentWallet("100.00");
    await expectReject(`UPDATE wallet_ledger_entries SET amount = '1.00' WHERE id = ?`, [entryId]);
    await expectReject(`DELETE FROM wallet_ledger_entries WHERE id = ?`, [entryId]);
  });

  test("ledger: an entry without the matching wallet update is rejected at commit (P1-1)", async () => {
    const walletId = await seedWallet(); // v1, saldo 0.00, sem lançamento
    const txId = crypto.randomUUID();
    let threw = false;
    try {
      await orm.em.transactional(async (em) => {
        const session = new SqlSession(em);
        await session.command(
          `INSERT INTO wager_transactions (id, provider_id, external_transaction_id, idempotency_key,
            payload_hash, requested_wallet_id, wallet_id, player_id, round_id, game_id, kind, amount,
            currency, status, correlation_id, created_at, processed_at, result_balance_amount, result_balance_currency)
           VALUES (?, 'provider-a', 'ext-orphan', 'k-orphan', 'v1:h', ?, ?, ?, 'r', 'g', 'WIN', '10.00', 'BRL',
            'PROCESSED', 'c', now(), now(), '10.00', 'BRL')`,
          [txId, walletId, walletId, crypto.randomUUID()],
        );
        // Lançamento de 10.00 SEM atualizar a wallet (continua 0.00 / v1).
        await session.command(
          `INSERT INTO wallet_ledger_entries (id, wallet_id, transaction_id, direction, amount, currency,
            balance_before, balance_after, wallet_version, created_at)
           VALUES (?, ?, ?, 'CREDIT', '10.00', 'BRL', '0.00', '10.00', 2, now())`,
          [crypto.randomUUID(), walletId, txId],
        );
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // E nada ficou: a wallet segue 0.00 e sem lançamentos.
    const entries = (await exec(`SELECT count(*)::int AS c FROM wallet_ledger_entries WHERE wallet_id = ?`, [walletId])) as { c: number }[];
    expect(entries[0]?.c).toBe(0);
  });

  test("ledger: broken arithmetic is rejected by the check", async () => {
    const walletId = await seedWallet();
    const txId = crypto.randomUUID();
    await exec(
      `INSERT INTO wager_transactions (id, provider_id, external_transaction_id, idempotency_key,
        payload_hash, requested_wallet_id, wallet_id, player_id, round_id, game_id, kind, amount,
        currency, status, correlation_id, created_at, processed_at, result_balance_amount, result_balance_currency)
       VALUES (?, 'provider-a', 'ext-5', 'k5', 'v1:h', ?, ?, ?, 'r', 'g', 'WIN', '10.00', 'BRL',
        'PROCESSED', 'c', now(), now(), '10.00', 'BRL')`,
      [txId, walletId, walletId, crypto.randomUUID()],
    );
    await expectReject(
      `INSERT INTO wallet_ledger_entries (id, wallet_id, transaction_id, direction, amount, currency,
        balance_before, balance_after, wallet_version, created_at)
       VALUES (?, ?, ?, 'CREDIT', '10.00', 'BRL', '0.00', '999.00', 2, now())`,
      [crypto.randomUUID(), walletId, txId],
    );
  });

  test("wager_transactions: a PROCESSED compensation with a null internal reference is rejected (ADR-001)", async () => {
    const walletId = await seedWallet();
    // REFUND PROCESSED sem reference_transaction_id: o índice único parcial seria burlado → CHECK barra.
    await expectReject(
      `INSERT INTO wager_transactions (id, provider_id, external_transaction_id, idempotency_key,
        payload_hash, requested_wallet_id, wallet_id, player_id, round_id, game_id, kind, amount,
        currency, reference_external_transaction_id, status, correlation_id, created_at, processed_at,
        result_balance_amount, result_balance_currency)
       VALUES (?, 'provider-a', 'ext-c', 'k-c', 'v1:h', ?, ?, ?, 'r', 'g', 'REFUND', '10.00', 'BRL',
        'ext-bet', 'PROCESSED', 'c', now(), now(), '10.00', 'BRL')`,
      [crypto.randomUUID(), walletId, walletId, crypto.randomUUID()],
    );
  });

  test("outbox: payload is immutable after insert", async () => {
    const id = crypto.randomUUID();
    await exec(
      `INSERT INTO outbox_messages (id, aggregate_id, event_type, payload, occurred_at, next_attempt_at)
       VALUES (?, 'wallet-1', 'WagerTransactionProcessed', '{"a":1}'::jsonb, now(), now())`,
      [id],
    );
    await expectReject(`UPDATE outbox_messages SET payload = '{"a":2}'::jsonb WHERE id = ?`, [id]);
  });

  test("ledger: TRUNCATE is blocked", async () => {
    await expectReject(`TRUNCATE wallet_ledger_entries`);
  });
});
