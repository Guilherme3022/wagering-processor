import { Inject, Injectable } from "@nestjs/common";
import { UNIT_OF_WORK, type UnitOfWork } from "../../shared/application/persistence";
import { Money, type MoneyProps } from "../../shared/domain/money";
import { LedgerDirection } from "../domain/ledger-direction";

export interface ReconciliationView {
  readonly walletId: string;
  readonly storedBalance: MoneyProps;
  readonly calculatedBalance: MoneyProps;
  readonly difference: MoneyProps;
  readonly consistent: boolean;
  readonly checkedEntries: number;
  /** Extra ao corpo do enunciado: a cadeia de versões do ledger está íntegra? */
  readonly chainValid: boolean;
}

/**
 * Reconcilia uma wallet (spec §7.2): compara o saldo materializado com `Σ CREDIT − Σ DEBIT` e
 * verifica a cadeia de versões, em `REPEATABLE READ` para um snapshot coerente. Nunca corrige;
 * só reporta. `null` quando a wallet não existe.
 */
@Injectable()
export class ReconcileWallet {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork) {}

  async execute(walletId: string): Promise<ReconciliationView | null> {
    return this.uow.transaction(
      async (ports) => {
        const wallet = await ports.wallets.findById(walletId);
        if (wallet === null) {
          return null;
        }
        const entries = await ports.ledger.allByWallet(walletId);

        let computed = Money.zero(wallet.currency);
        let chainValid = true;
        let previousAfter: Money | null = null;
        let previousVersion: number | null = null;

        for (const entry of entries) {
          computed =
            entry.direction === LedgerDirection.Credit
              ? computed.add(entry.money)
              : computed.subtract(entry.money);
          if (previousAfter === null) {
            if (!entry.balanceBefore.isZero()) {
              chainValid = false;
            }
          } else {
            if (!entry.balanceBefore.equals(previousAfter)) {
              chainValid = false;
            }
            if (previousVersion !== null && entry.walletVersion !== previousVersion + 1) {
              chainValid = false;
            }
          }
          previousAfter = entry.balanceAfter;
          previousVersion = entry.walletVersion;
        }

        const difference = wallet.balance.subtract(computed);
        const lastMatches = previousAfter === null || previousAfter.equals(wallet.balance);
        const consistent = difference.isZero() && chainValid && lastMatches;

        return {
          walletId,
          storedBalance: wallet.balance.toJSON(),
          calculatedBalance: computed.toJSON(),
          difference: difference.toJSON(),
          consistent,
          checkedEntries: entries.length,
          chainValid,
        };
      },
      { isolationLevel: "repeatable read" },
    );
  }
}
