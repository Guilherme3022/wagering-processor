import { Inject, Injectable } from "@nestjs/common";
import { UNIT_OF_WORK, type UnitOfWork } from "../../shared/application/persistence";
import { type MoneyProps } from "../../shared/domain/money";
import { type LedgerEntrySnapshot } from "../domain/wallet-ledger-entry";

export interface LedgerItemView {
  readonly id: string;
  readonly transactionId: string;
  readonly direction: string;
  readonly money: MoneyProps;
  readonly balanceBefore: MoneyProps;
  readonly balanceAfter: MoneyProps;
  readonly walletVersion: number;
  readonly createdAt: string;
}

export interface LedgerPageView {
  readonly items: readonly LedgerItemView[];
  readonly nextSeq: bigint | null;
}

/** Página do ledger por cursor de `seq` (spec §7.2). Busca `limit + 1` para saber se há próxima. */
@Injectable()
export class ListLedger {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork) {}

  async execute(walletId: string, afterSeq: bigint | null, limit: number): Promise<LedgerPageView> {
    return this.uow.transaction(async (ports) => {
      const rows = await ports.ledger.page(walletId, afterSeq, limit + 1);
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      const nextSeq = hasMore && last ? last.seq : null;
      return { items: page.map(toItem), nextSeq };
    });
  }
}

function toItem(entry: LedgerEntrySnapshot): LedgerItemView {
  return {
    id: entry.id,
    transactionId: entry.transactionId,
    direction: entry.direction,
    money: entry.money.toJSON(),
    balanceBefore: entry.balanceBefore.toJSON(),
    balanceAfter: entry.balanceAfter.toJSON(),
    walletVersion: entry.walletVersion,
    createdAt: entry.createdAt.toISOString(),
  };
}
