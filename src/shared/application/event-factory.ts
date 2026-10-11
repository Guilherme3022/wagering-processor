import {
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
} from "../events/wagering-events";
import { type WalletLedgerEntry } from "../../wallet/domain/wallet-ledger-entry";
import { type WagerTransaction } from "../../wagering/domain/wager-transaction";

/**
 * Constrói os eventos de integração a partir dos agregados já no estado final. Função pura:
 * recebe o `eventId` e o `causationId` prontos (gerados pela aplicação) e não toca em infra.
 */
export function processedEvent(params: {
  tx: WagerTransaction;
  eventId: string;
  causationId: string;
}): WagerTransactionProcessed {
  const { tx } = params;
  const walletId = tx.walletId ?? tx.requestedWalletId;
  const processedAt = (tx.processedAt ?? tx.createdAt).toISOString();
  return WagerTransactionProcessed.from({
    eventId: params.eventId,
    aggregateId: walletId,
    occurredAt: tx.processedAt ?? tx.createdAt,
    context: { correlationId: tx.correlationId, causationId: params.causationId },
    data: {
      transactionId: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      walletId,
      playerId: tx.playerId,
      roundId: tx.roundId,
      gameId: tx.gameId,
      kind: tx.kind,
      money: tx.money.toJSON(),
      referenceTransactionId: tx.referenceTransactionId,
      balanceAfter: (tx.resultBalance ?? tx.money).toJSON(),
      processedAt,
    },
  });
}

export function rejectedEvent(params: {
  tx: WagerTransaction;
  eventId: string;
  causationId: string;
  rejectedAt: Date;
}): WagerTransactionRejected {
  const { tx } = params;
  return WagerTransactionRejected.from({
    eventId: params.eventId,
    aggregateId: tx.walletId ?? tx.requestedWalletId,
    occurredAt: params.rejectedAt,
    context: { correlationId: tx.correlationId, causationId: params.causationId },
    data: {
      transactionId: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      walletId: tx.walletId,
      requestedWalletId: tx.requestedWalletId,
      kind: tx.kind,
      money: tx.money.toJSON(),
      failureCode: tx.failureCode ?? "PROCESSING_FAILED",
      rejectedAt: params.rejectedAt.toISOString(),
    },
  });
}

export function balanceChangedEvent(params: {
  entry: WalletLedgerEntry;
  eventId: string;
  causationId: string;
  correlationId: string;
}): WalletBalanceChanged {
  const { entry } = params;
  return WalletBalanceChanged.from({
    eventId: params.eventId,
    aggregateId: entry.walletId,
    occurredAt: entry.createdAt,
    context: { correlationId: params.correlationId, causationId: params.causationId },
    data: {
      walletId: entry.walletId,
      transactionId: entry.transactionId,
      direction: entry.direction,
      money: entry.money.toJSON(),
      balanceBefore: entry.balanceBefore.toJSON(),
      balanceAfter: entry.balanceAfter.toJSON(),
      walletVersion: entry.walletVersion,
    },
  });
}

export function pendingReferenceEvent(params: {
  tx: WagerTransaction;
  eventId: string;
  causationId: string;
}): WagerTransactionPendingReference {
  const { tx } = params;
  return WagerTransactionPendingReference.from({
    eventId: params.eventId,
    aggregateId: tx.walletId ?? tx.requestedWalletId,
    occurredAt: tx.createdAt,
    context: { correlationId: tx.correlationId, causationId: params.causationId },
    data: {
      transactionId: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      walletId: tx.walletId ?? tx.requestedWalletId,
      kind: tx.kind,
      referenceExternalTransactionId: tx.referenceExternalTransactionId ?? "",
      deadlineAt: (tx.referenceDeadlineAt ?? tx.createdAt).toISOString(),
    },
  });
}
