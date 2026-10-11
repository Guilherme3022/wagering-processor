import { Inject, Injectable } from "@nestjs/common";
import { UNIT_OF_WORK, type UnitOfWork } from "../../shared/application/persistence";
import { type MoneyProps } from "../../shared/domain/money";
import { type WagerTransaction } from "../domain/wager-transaction";

export interface TransactionView {
  readonly id: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly walletId: string | null;
  readonly playerId: string;
  readonly roundId: string | null;
  readonly gameId: string | null;
  readonly kind: string;
  readonly money: MoneyProps;
  readonly referenceExternalTransactionId: string | null;
  readonly referenceTransactionId: string | null;
  readonly status: string;
  readonly failureCode: string | null;
  readonly resultBalance: MoneyProps | null;
  readonly createdAt: string;
  readonly processedAt: string | null;
}

/** Consulta de transação por id ou por `(providerId, externalTransactionId)` (spec §7.2). */
@Injectable()
export class GetTransaction {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork) {}

  byId(id: string): Promise<TransactionView | null> {
    return this.uow.transaction(async (ports) => {
      const tx = await ports.transactions.findById(id);
      return tx === null ? null : toView(tx);
    });
  }

  byProviderExternal(providerId: string, externalTransactionId: string): Promise<TransactionView | null> {
    return this.uow.transaction(async (ports) => {
      const tx = await ports.transactions.findByProviderExternal(providerId, externalTransactionId);
      return tx === null ? null : toView(tx);
    });
  }
}

function toView(tx: WagerTransaction): TransactionView {
  return {
    id: tx.id,
    providerId: tx.providerId,
    externalTransactionId: tx.externalTransactionId,
    walletId: tx.walletId,
    playerId: tx.playerId,
    roundId: tx.roundId,
    gameId: tx.gameId,
    kind: tx.kind,
    money: tx.money.toJSON(),
    referenceExternalTransactionId: tx.referenceExternalTransactionId,
    referenceTransactionId: tx.referenceTransactionId,
    status: tx.status,
    failureCode: tx.failureCode,
    resultBalance: tx.resultBalance?.toJSON() ?? null,
    createdAt: tx.createdAt.toISOString(),
    processedAt: tx.processedAt?.toISOString() ?? null,
  };
}
