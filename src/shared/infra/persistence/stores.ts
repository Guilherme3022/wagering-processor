import {
  type InboxState,
  type InboxStore,
  type LedgerStore,
  type OutboxStore,
  type WagerTransactionStore,
  type WalletStore,
} from "../../application/persistence";
import { type AnyIntegrationEvent } from "../../events/wagering-events";
import { type Wallet, type WalletSnapshot } from "../../../wallet/domain/wallet";
import { WalletAlreadyExistsError } from "../../../wallet/domain/wallet-errors";
import { type WalletLedgerEntry, type LedgerEntrySnapshot } from "../../../wallet/domain/wallet-ledger-entry";
import { type WagerTransaction } from "../../../wagering/domain/wager-transaction";
import { ConcurrentWriteError } from "../../application/concurrent-write-error";
import { isUniqueViolation, pgConstraint } from "../http/db-error";

const IDEMPOTENCY_CONSTRAINTS = new Set(["uq_wtx_idempotency_key", "uq_wtx_provider_external"]);

/** Traduz `23505` nas constraints de idempotência/duplicidade em `ConcurrentWriteError`. */
function translateConcurrency(error: unknown): never {
  if (isUniqueViolation(error)) {
    const constraint = pgConstraint(error);
    if (constraint !== undefined && IDEMPOTENCY_CONSTRAINTS.has(constraint)) {
      throw new ConcurrentWriteError(constraint);
    }
  }
  throw error;
}
import {
  type LedgerRow,
  toLedgerSnapshot,
  toWagerTransaction,
  toWalletSnapshot,
  type WagerTransactionRow,
  type WalletRow,
} from "./mappers";
import { type SqlSession } from "./sql-session";

const TX_COLUMNS = `id, provider_id, external_transaction_id, idempotency_key, payload_hash,
  requested_wallet_id, wallet_id, player_id, round_id, game_id, kind, amount, currency,
  reference_external_transaction_id, reference_transaction_id, status, failure_code,
  result_balance_amount, result_balance_currency, reference_attempts, next_reference_attempt_at,
  reference_deadline_at, correlation_id, created_at, processed_at`;

const TX_SELECT = `SELECT ${TX_COLUMNS} FROM wager_transactions`;

function txParams(tx: WagerTransaction): unknown[] {
  return [
    tx.id,
    tx.providerId,
    tx.externalTransactionId,
    tx.idempotencyKey,
    tx.payloadHash,
    tx.requestedWalletId,
    tx.walletId,
    tx.playerId,
    tx.roundId,
    tx.gameId,
    tx.kind,
    tx.money.toString(),
    tx.money.currency,
    tx.referenceExternalTransactionId,
    tx.referenceTransactionId,
    tx.status,
    tx.failureCode,
    tx.resultBalance?.toString() ?? null,
    tx.resultBalance?.currency ?? null,
    tx.referenceAttempts,
    tx.nextReferenceAttemptAt,
    tx.referenceDeadlineAt,
    tx.correlationId,
    tx.createdAt,
    tx.processedAt,
  ];
}

export class SqlWalletStore implements WalletStore {
  constructor(private readonly session: SqlSession) {}

  async insert(wallet: Wallet): Promise<void> {
    try {
      await this.session.command(
        `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          wallet.id,
          wallet.playerId,
          wallet.currency,
          wallet.balance.toString(),
          wallet.version,
          wallet.createdAt,
          wallet.updatedAt,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new WalletAlreadyExistsError();
      }
      throw error;
    }
  }

  async findById(id: string): Promise<WalletSnapshot | null> {
    const rows = await this.session.select<WalletRow>(`SELECT * FROM wallets WHERE id = ?`, [id]);
    return rows[0] ? toWalletSnapshot(rows[0]) : null;
  }

  async lockById(id: string): Promise<WalletSnapshot | null> {
    const rows = await this.session.select<WalletRow>(
      `SELECT * FROM wallets WHERE id = ? FOR UPDATE`,
      [id],
    );
    return rows[0] ? toWalletSnapshot(rows[0]) : null;
  }

  updateBalance(params: {
    id: string;
    newBalance: Wallet["balance"];
    expectedVersion: number;
    newVersion: number;
    at: Date;
  }): Promise<number> {
    return this.session.command(
      `UPDATE wallets SET balance_amount = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?`,
      [params.newBalance.toString(), params.newVersion, params.at, params.id, params.expectedVersion],
    );
  }
}

export class SqlLedgerStore implements LedgerStore {
  constructor(private readonly session: SqlSession) {}

  async insert(entry: WalletLedgerEntry): Promise<void> {
    await this.session.command(
      `INSERT INTO wallet_ledger_entries
         (id, wallet_id, transaction_id, direction, amount, currency,
          balance_before, balance_after, wallet_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.walletId,
        entry.transactionId,
        entry.direction,
        entry.money.toString(),
        entry.money.currency,
        entry.balanceBefore.toString(),
        entry.balanceAfter.toString(),
        entry.walletVersion,
        entry.createdAt,
      ],
    );
  }

  async page(walletId: string, afterSeq: bigint | null, limit: number): Promise<LedgerEntrySnapshot[]> {
    const where = afterSeq === null ? "wallet_id = ?" : "wallet_id = ? AND seq > ?";
    const params = afterSeq === null ? [walletId, limit] : [walletId, afterSeq.toString(), limit];
    const rows = await this.session.select<LedgerRow>(
      `SELECT * FROM wallet_ledger_entries WHERE ${where} ORDER BY seq ASC LIMIT ?`,
      params,
    );
    return rows.map(toLedgerSnapshot);
  }

  async allByWallet(walletId: string): Promise<LedgerEntrySnapshot[]> {
    const rows = await this.session.select<LedgerRow>(
      `SELECT * FROM wallet_ledger_entries WHERE wallet_id = ? ORDER BY wallet_version ASC`,
      [walletId],
    );
    return rows.map(toLedgerSnapshot);
  }
}

export class SqlWagerTransactionStore implements WagerTransactionStore {
  constructor(private readonly session: SqlSession) {}

  private readonly insertSql = `INSERT INTO wager_transactions (${TX_COLUMNS})
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  async insert(tx: WagerTransaction): Promise<void> {
    try {
      await this.session.command(this.insertSql, txParams(tx));
    } catch (error) {
      translateConcurrency(error);
    }
  }

  async insertIfAbsent(tx: WagerTransaction): Promise<boolean> {
    try {
      const affected = await this.session.command(
        `${this.insertSql} ON CONFLICT (idempotency_key) DO NOTHING`,
        txParams(tx),
      );
      return affected > 0;
    } catch (error) {
      // `ON CONFLICT (idempotency_key)` não cobre uq_wtx_provider_external → pode vir 23505 aqui.
      translateConcurrency(error);
    }
  }

  async update(tx: WagerTransaction): Promise<void> {
    await this.session.command(
      `UPDATE wager_transactions SET
         status = ?, failure_code = ?, result_balance_amount = ?, result_balance_currency = ?,
         reference_transaction_id = ?, reference_attempts = ?, next_reference_attempt_at = ?,
         reference_deadline_at = ?, wallet_id = COALESCE(wallet_id, ?), processed_at = ?
       WHERE id = ?`,
      [
        tx.status,
        tx.failureCode,
        tx.resultBalance?.toString() ?? null,
        tx.resultBalance?.currency ?? null,
        tx.referenceTransactionId,
        tx.referenceAttempts,
        tx.nextReferenceAttemptAt,
        tx.referenceDeadlineAt,
        tx.walletId,
        tx.processedAt,
        tx.id,
      ],
    );
  }

  async lockById(id: string): Promise<WagerTransaction | null> {
    const rows = await this.session.select<WagerTransactionRow>(
      `${TX_SELECT} WHERE id = ? FOR UPDATE`,
      [id],
    );
    return rows[0] ? toWagerTransaction(rows[0]) : null;
  }

  async hasProcessedCompensation(referenceTransactionId: string): Promise<boolean> {
    const rows = await this.session.select<{ one: number }>(
      `SELECT 1 AS one FROM wager_transactions
        WHERE reference_transaction_id = ? AND status = 'PROCESSED' AND kind IN ('REFUND','ROLLBACK')
        LIMIT 1`,
      [referenceTransactionId],
    );
    return rows.length > 0;
  }

  async rescheduleDependents(providerId: string, externalTransactionId: string, at: Date): Promise<void> {
    await this.session.command(
      `UPDATE wager_transactions SET next_reference_attempt_at = ?
        WHERE status = 'PENDING_REFERENCE' AND provider_id = ? AND reference_external_transaction_id = ?`,
      [at, providerId, externalTransactionId],
    );
  }

  async claimPendingReferenceDue(now: Date, limit: number): Promise<string[]> {
    const rows = await this.session.select<{ id: string }>(
      `SELECT id FROM wager_transactions
        WHERE status = 'PENDING_REFERENCE' AND next_reference_attempt_at <= ?
        ORDER BY next_reference_attempt_at LIMIT ? FOR UPDATE SKIP LOCKED`,
      [now, limit],
    );
    return rows.map((row) => row.id);
  }

  async countPendingReference(): Promise<number> {
    const rows = await this.session.select<{ count: number }>(
      `SELECT count(*)::int AS count FROM wager_transactions WHERE status = 'PENDING_REFERENCE'`,
    );
    return rows[0]?.count ?? 0;
  }

  async findByIdempotencyKey(key: string): Promise<WagerTransaction | null> {
    const rows = await this.session.select<WagerTransactionRow>(
      `${TX_SELECT} WHERE idempotency_key = ?`,
      [key],
    );
    return rows[0] ? toWagerTransaction(rows[0]) : null;
  }

  async findByProviderExternal(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    const rows = await this.session.select<WagerTransactionRow>(
      `${TX_SELECT} WHERE provider_id = ? AND external_transaction_id = ?`,
      [providerId, externalTransactionId],
    );
    return rows[0] ? toWagerTransaction(rows[0]) : null;
  }

  async findById(id: string): Promise<WagerTransaction | null> {
    const rows = await this.session.select<WagerTransactionRow>(`${TX_SELECT} WHERE id = ?`, [id]);
    return rows[0] ? toWagerTransaction(rows[0]) : null;
  }
}

export class SqlInboxStore implements InboxStore {
  constructor(private readonly session: SqlSession) {}

  async register(
    consumerName: string,
    messageId: string,
    payloadHash: string,
    at: Date,
  ): Promise<InboxState> {
    const inserted = await this.session.command(
      `INSERT INTO inbox_messages (consumer_name, message_id, payload_hash, received_at)
       VALUES (?, ?, ?, ?) ON CONFLICT (consumer_name, message_id) DO NOTHING`,
      [consumerName, messageId, payloadHash, at],
    );
    if (inserted > 0) {
      return "inserted";
    }
    const rows = await this.session.select<{ payload_hash: string }>(
      `SELECT payload_hash FROM inbox_messages WHERE consumer_name = ? AND message_id = ?`,
      [consumerName, messageId],
    );
    return rows[0]?.payload_hash === payloadHash ? "duplicate" : "conflict";
  }

  async markProcessed(consumerName: string, messageId: string, at: Date): Promise<void> {
    await this.session.command(
      `UPDATE inbox_messages SET processed_at = ? WHERE consumer_name = ? AND message_id = ?`,
      [at, consumerName, messageId],
    );
  }
}

export class SqlOutboxStore implements OutboxStore {
  constructor(private readonly session: SqlSession) {}

  async enqueue(event: AnyIntegrationEvent, occurredAt: Date): Promise<void> {
    const envelope = event.toJSON();
    await this.session.command(
      `INSERT INTO outbox_messages (id, aggregate_id, event_type, payload, occurred_at, attempts, next_attempt_at)
       VALUES (?, ?, ?, ?::jsonb, ?, 0, ?)`,
      [envelope.eventId, envelope.aggregateId, envelope.eventType, JSON.stringify(envelope), occurredAt, occurredAt],
    );
  }
}
