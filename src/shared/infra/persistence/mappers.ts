import { Money } from "../../domain/money";
import { type FailureCode } from "../../domain/failure-code";
import { type LedgerDirection } from "../../../wallet/domain/ledger-direction";
import { type LedgerEntrySnapshot } from "../../../wallet/domain/wallet-ledger-entry";
import { WalletLedgerEntry } from "../../../wallet/domain/wallet-ledger-entry";
import { type WalletSnapshot } from "../../../wallet/domain/wallet";
import { type WagerKind } from "../../../wagering/domain/wager-kind";
import { type WagerStatus } from "../../../wagering/domain/wager-status";
import { WagerTransaction } from "../../../wagering/domain/wager-transaction";
import { MoneyAmountType } from "./money-amount.type";

const money = new MoneyAmountType();

/** Linhas cruas do PostgreSQL (nomes snake_case). */
export interface WalletRow {
  id: string;
  player_id: string;
  currency: string;
  balance_amount: string;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface LedgerRow {
  id: string;
  seq: string | number;
  wallet_id: string;
  transaction_id: string;
  direction: LedgerDirection;
  amount: string;
  currency: string;
  balance_before: string;
  balance_after: string;
  wallet_version: number;
  created_at: Date | string;
}

export interface WagerTransactionRow {
  id: string;
  provider_id: string;
  external_transaction_id: string;
  idempotency_key: string;
  payload_hash: string;
  requested_wallet_id: string;
  wallet_id: string | null;
  player_id: string;
  round_id: string | null;
  game_id: string | null;
  kind: WagerKind;
  amount: string;
  currency: string;
  reference_external_transaction_id: string | null;
  reference_transaction_id: string | null;
  status: WagerStatus;
  failure_code: FailureCode | null;
  result_balance_amount: string | null;
  result_balance_currency: string | null;
  reference_attempts: number;
  next_reference_attempt_at: Date | string | null;
  reference_deadline_at: Date | string | null;
  correlation_id: string;
  created_at: Date | string;
  processed_at: Date | string | null;
}

const toMoney = (amount: string, currency: string): Money =>
  Money.fromUnits(money.convertToJSValue(amount), currency.trim());

const toDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));
const toDateOrNull = (value: Date | string | null): Date | null =>
  value === null ? null : toDate(value);

export function toWalletSnapshot(row: WalletRow): WalletSnapshot {
  return {
    id: row.id,
    playerId: row.player_id,
    currency: row.currency.trim(),
    balance: toMoney(row.balance_amount, row.currency),
    version: row.version,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export function toLedgerSnapshot(row: LedgerRow): LedgerEntrySnapshot {
  const currency = row.currency.trim();
  return {
    id: row.id,
    seq: BigInt(row.seq),
    walletId: row.wallet_id,
    transactionId: row.transaction_id,
    direction: row.direction,
    money: toMoney(row.amount, currency),
    balanceBefore: toMoney(row.balance_before, currency),
    balanceAfter: toMoney(row.balance_after, currency),
    walletVersion: row.wallet_version,
    createdAt: toDate(row.created_at),
  };
}

export function toLedgerEntry(row: LedgerRow): WalletLedgerEntry {
  return WalletLedgerEntry.rehydrate(toLedgerSnapshot(row));
}

export function toWagerTransaction(row: WagerTransactionRow): WagerTransaction {
  const currency = row.currency.trim();
  return WagerTransaction.rehydrate({
    id: row.id,
    providerId: row.provider_id,
    externalTransactionId: row.external_transaction_id,
    idempotencyKey: row.idempotency_key,
    payloadHash: row.payload_hash,
    requestedWalletId: row.requested_wallet_id,
    walletId: row.wallet_id,
    playerId: row.player_id,
    roundId: row.round_id,
    gameId: row.game_id,
    kind: row.kind,
    money: toMoney(row.amount, currency),
    referenceExternalTransactionId: row.reference_external_transaction_id,
    correlationId: row.correlation_id,
    createdAt: toDate(row.created_at),
    referenceTransactionId: row.reference_transaction_id,
    status: row.status,
    failureCode: row.failure_code,
    resultBalance:
      row.result_balance_amount === null
        ? null
        : toMoney(row.result_balance_amount, row.result_balance_currency ?? currency),
    referenceAttempts: row.reference_attempts,
    nextReferenceAttemptAt: toDateOrNull(row.next_reference_attempt_at),
    referenceDeadlineAt: toDateOrNull(row.reference_deadline_at),
    processedAt: toDateOrNull(row.processed_at),
  });
}
