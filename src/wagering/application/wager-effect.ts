import { InvariantViolationError } from "../../shared/domain/domain-error";
import { type FailureCode, FailureCode as Codes } from "../../shared/domain/failure-code";
import { type Money } from "../../shared/domain/money";
import { LedgerDirection } from "../../wallet/domain/ledger-direction";
import { type Wallet } from "../../wallet/domain/wallet";
import { type WalletLedgerEntry } from "../../wallet/domain/wallet-ledger-entry";
import { WagerKind } from "../domain/wager-kind";

export type EffectOutcome =
  | { readonly type: "processed"; readonly entry: WalletLedgerEntry | null; readonly balance: Money; readonly referenceId: string | null }
  | { readonly type: "rejected"; readonly failureCode: FailureCode; readonly balance: Money };

/**
 * Aplica o efeito de saldo de um kind já com a referência resolvida (spec §3.4). Mutação acontece
 * no agregado `Wallet`; saldo insuficiente vira rejeição de negócio (não exceção). Pura: recebe
 * `entryId`/`txId`/`at` prontos, então serve tanto ao fluxo síncrono quanto ao worker.
 */
export function applyEffect(params: {
  wallet: Wallet;
  kind: WagerKind;
  money: Money;
  direction: LedgerDirection | null;
  entryId: string;
  txId: string;
  at: Date;
  referenceId: string | null;
}): EffectOutcome {
  const { wallet, kind, money, entryId, txId, at, referenceId } = params;

  if (kind === WagerKind.Loss) {
    return { type: "processed", entry: null, balance: wallet.balance, referenceId };
  }
  if (kind === WagerKind.Bet) {
    if (wallet.balance.isLessThan(money)) {
      return { type: "rejected", failureCode: Codes.InsufficientFunds, balance: wallet.balance };
    }
    const entry = wallet.debit({ entryId, transactionId: txId, money, at });
    return { type: "processed", entry, balance: wallet.balance, referenceId };
  }
  if (kind === WagerKind.Win) {
    const entry = wallet.credit({ entryId, transactionId: txId, money, at });
    return { type: "processed", entry, balance: wallet.balance, referenceId };
  }

  // REFUND / ROLLBACK — direção vem da política de referência.
  if (params.direction === null) {
    throw new InvariantViolationError("compensation effect requires a resolved direction");
  }
  if (params.direction === LedgerDirection.Debit && wallet.balance.isLessThan(money)) {
    return { type: "rejected", failureCode: Codes.ReversalInsufficientFunds, balance: wallet.balance };
  }
  const entry = wallet.reverse({ entryId, transactionId: txId, direction: params.direction, money, at });
  return { type: "processed", entry, balance: wallet.balance, referenceId };
}
