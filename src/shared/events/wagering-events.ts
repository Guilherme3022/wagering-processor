import { type MoneyProps } from "../domain/money";
import { IntegrationEvent, type IntegrationEventParams } from "./integration-event";

/** Direção de um lançamento, como string JSON no contrato de evento. */
export type LedgerDirectionName = "DEBIT" | "CREDIT";

export interface WagerTransactionProcessedData {
  readonly transactionId: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string | null;
  readonly gameId: string | null;
  readonly kind: string;
  readonly money: MoneyProps;
  readonly referenceTransactionId: string | null;
  readonly balanceAfter: MoneyProps;
  readonly processedAt: string;
}

export interface WagerTransactionRejectedData {
  readonly transactionId: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly walletId: string | null;
  readonly requestedWalletId: string;
  readonly kind: string;
  readonly money: MoneyProps;
  readonly failureCode: string;
  readonly rejectedAt: string;
}

export interface WalletBalanceChangedData {
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirectionName;
  readonly money: MoneyProps;
  readonly balanceBefore: MoneyProps;
  readonly balanceAfter: MoneyProps;
  readonly walletVersion: number;
}

export interface WagerTransactionPendingReferenceData {
  readonly transactionId: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly walletId: string;
  readonly kind: string;
  readonly referenceExternalTransactionId: string;
  readonly deadlineAt: string;
}

/** Toda transação `PROCESSED`, inclusive `LOSS` e `OPENING` (spec §8.3). */
export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = "WagerTransactionProcessed";
  readonly version = 1;

  static from(params: IntegrationEventParams<WagerTransactionProcessedData>): WagerTransactionProcessed {
    return new WagerTransactionProcessed(params);
  }
}

/** Toda transação `REJECTED`, inclusive o prazo de referência vencido (spec §8.3). */
export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = "WagerTransactionRejected";
  readonly version = 1;

  static from(params: IntegrationEventParams<WagerTransactionRejectedData>): WagerTransactionRejected {
    return new WagerTransactionRejected(params);
  }
}

/** Emitido apenas quando houve lançamento no ledger (spec §8.3). */
export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = "WalletBalanceChanged";
  readonly version = 1;

  static from(params: IntegrationEventParams<WalletBalanceChangedData>): WalletBalanceChanged {
    return new WalletBalanceChanged(params);
  }
}

/** Emitido uma única vez ao entrar em `PENDING_REFERENCE`, não a cada tentativa (spec §8.3). */
export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = "WagerTransactionPendingReference";
  readonly version = 1;

  static from(
    params: IntegrationEventParams<WagerTransactionPendingReferenceData>,
  ): WagerTransactionPendingReference {
    return new WagerTransactionPendingReference(params);
  }
}

export type AnyIntegrationEvent =
  | WagerTransactionProcessed
  | WagerTransactionRejected
  | WalletBalanceChanged
  | WagerTransactionPendingReference;
