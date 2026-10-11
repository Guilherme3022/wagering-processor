import { type Money } from "../../shared/domain/money";
import { WagerKind } from "./wager-kind";
import { WagerTransaction } from "./wager-transaction";

/** `provider_id` sintético do `OPENING` — inválido pela regex da API, sem colisão (spec §3.6). */
export const SYSTEM_PROVIDER_ID = "__system__";

export function openingExternalTransactionId(walletId: string): string {
  return `opening:${walletId}`;
}

export function openingIdempotencyKey(walletId: string): string {
  return `${SYSTEM_PROVIDER_ID}:opening:${walletId}`;
}

/** Campos de negócio do `OPENING` que entram no hash de idempotência (spec §3.5/§3.6). */
export function openingHashPayload(params: {
  walletId: string;
  playerId: string;
  money: Money;
}): {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: null;
  gameId: null;
  kind: typeof WagerKind.Opening;
  money: { amount: string; currency: string };
  referenceExternalTransactionId: null;
} {
  return {
    providerId: SYSTEM_PROVIDER_ID,
    externalTransactionId: openingExternalTransactionId(params.walletId),
    playerId: params.playerId,
    walletId: params.walletId,
    roundId: null,
    gameId: null,
    kind: WagerKind.Opening,
    money: params.money.toJSON(),
    referenceExternalTransactionId: null,
  };
}

/** Cria a transação interna `OPENING` já `PROCESSED` que lastreia o saldo inicial (spec §6.3). */
export function createOpeningTransaction(params: {
  id: string;
  walletId: string;
  playerId: string;
  money: Money;
  payloadHash: string;
  correlationId: string;
  at: Date;
}): WagerTransaction {
  const tx = WagerTransaction.create({
    id: params.id,
    providerId: SYSTEM_PROVIDER_ID,
    externalTransactionId: openingExternalTransactionId(params.walletId),
    idempotencyKey: openingIdempotencyKey(params.walletId),
    payloadHash: params.payloadHash,
    requestedWalletId: params.walletId,
    walletId: params.walletId,
    playerId: params.playerId,
    roundId: null,
    gameId: null,
    kind: WagerKind.Opening,
    money: params.money,
    referenceExternalTransactionId: null,
    correlationId: params.correlationId,
    createdAt: params.at,
  });
  tx.markProcessed({
    walletId: params.walletId,
    resultBalance: params.money,
    referenceTransactionId: null,
    at: params.at,
  });
  return tx;
}
