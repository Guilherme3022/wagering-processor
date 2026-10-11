import { InvariantViolationError } from "../../shared/domain/domain-error";
import { type Money } from "../../shared/domain/money";
import { LedgerDirection } from "./ledger-direction";

/** Dados para criar um lançamento. `balanceAfter` é derivado da direção pela factory. */
export interface LedgerEntryParams {
  readonly id: string;
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly money: Money;
  readonly balanceBefore: Money;
  readonly walletVersion: number;
  readonly at: Date;
}

/** Forma persistida, inclusive `seq` e `balanceAfter` já calculados (mapper → `rehydrate`). */
export interface LedgerEntrySnapshot {
  readonly id: string;
  readonly seq: bigint | null;
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly money: Money;
  readonly balanceBefore: Money;
  readonly balanceAfter: Money;
  readonly walletVersion: number;
  readonly createdAt: Date;
}

/**
 * Lançamento imutável e append-only do ledger (spec §3.3). Toda mudança de saldo produz
 * exatamente um destes, com `balanceBefore ± money === balanceAfter`. A factory valida a
 * aritmética; violá-la é bug (os mesmos CHECKs existem no banco como última linha de defesa).
 */
export class WalletLedgerEntry {
  private constructor(
    readonly id: string,
    readonly seq: bigint | null,
    readonly walletId: string,
    readonly transactionId: string,
    readonly direction: LedgerDirection,
    readonly money: Money,
    readonly balanceBefore: Money,
    readonly balanceAfter: Money,
    readonly walletVersion: number,
    readonly createdAt: Date,
  ) {}

  /** Cria um lançamento novo, calculando e validando `balanceAfter`. */
  static create(params: LedgerEntryParams): WalletLedgerEntry {
    const { money, balanceBefore, direction } = params;
    if (!money.isPositive()) {
      throw new InvariantViolationError("ledger entry amount must be positive");
    }
    const balanceAfter =
      direction === LedgerDirection.Credit
        ? balanceBefore.add(money)
        : balanceBefore.subtract(money);
    if (balanceAfter.isNegative()) {
      throw new InvariantViolationError("ledger entry cannot leave a negative balance");
    }
    if (params.walletVersion < 1) {
      throw new InvariantViolationError("ledger entry wallet version must be at least 1");
    }
    return new WalletLedgerEntry(
      params.id,
      null,
      params.walletId,
      params.transactionId,
      direction,
      money,
      balanceBefore,
      balanceAfter,
      params.walletVersion,
      params.at,
    );
  }

  /** Reconstrói a partir da persistência sem revalidar (ADR-007). */
  static rehydrate(snapshot: LedgerEntrySnapshot): WalletLedgerEntry {
    return new WalletLedgerEntry(
      snapshot.id,
      snapshot.seq,
      snapshot.walletId,
      snapshot.transactionId,
      snapshot.direction,
      snapshot.money,
      snapshot.balanceBefore,
      snapshot.balanceAfter,
      snapshot.walletVersion,
      snapshot.createdAt,
    );
  }
}
