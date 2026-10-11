import { InvariantViolationError } from "../../shared/domain/domain-error";
import { Money } from "../../shared/domain/money";
import { LedgerDirection } from "./ledger-direction";
import { InsufficientFundsError, ReversalInsufficientFundsError } from "./wallet-errors";
import { WalletLedgerEntry } from "./wallet-ledger-entry";

export interface OpenWalletParams {
  readonly id: string;
  readonly playerId: string;
  readonly initialBalance: Money;
  readonly openingTransactionId: string;
  readonly openingEntryId: string;
  readonly at: Date;
}

export interface WalletMutationParams {
  readonly entryId: string;
  readonly transactionId: string;
  readonly money: Money;
  readonly at: Date;
}

export interface ReverseParams extends WalletMutationParams {
  readonly direction: LedgerDirection;
}

export interface WalletSnapshot {
  readonly id: string;
  readonly playerId: string;
  readonly currency: string;
  readonly balance: Money;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Resultado de abrir uma wallet: o agregado e, quando o saldo inicial é positivo, o lançamento. */
export interface OpenWalletResult {
  readonly wallet: Wallet;
  readonly openingEntry: WalletLedgerEntry | undefined;
}

/**
 * Agregado de saldo (spec §3.2). Construtor privado; muda só por `credit`/`debit`/`reverse`,
 * que sempre devolvem o `WalletLedgerEntry` correspondente — não há como mover saldo sem
 * produzir um lançamento. `version` só avança quando o saldo muda.
 */
export class Wallet {
  private constructor(
    readonly id: string,
    readonly playerId: string,
    readonly currency: string,
    private _balance: Money,
    private _version: number,
    readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  /**
   * Abre a wallet na versão 1. Saldo inicial positivo gera um `CREDIT` de `0 → saldo` ainda na
   * versão 1 (o `OPENING`); saldo zero não gera lançamento. Saldo inicial negativo é bug.
   */
  static open(params: OpenWalletParams): OpenWalletResult {
    const { initialBalance } = params;
    if (initialBalance.isNegative()) {
      throw new InvariantViolationError("initial balance cannot be negative");
    }
    const wallet = new Wallet(
      params.id,
      params.playerId,
      initialBalance.currency,
      initialBalance,
      1,
      params.at,
      params.at,
    );
    if (initialBalance.isZero()) {
      return { wallet, openingEntry: undefined };
    }
    const openingEntry = WalletLedgerEntry.create({
      id: params.openingEntryId,
      walletId: wallet.id,
      transactionId: params.openingTransactionId,
      direction: LedgerDirection.Credit,
      money: initialBalance,
      balanceBefore: Money.zero(wallet.currency),
      walletVersion: 1,
      at: params.at,
    });
    return { wallet, openingEntry };
  }

  static rehydrate(snapshot: WalletSnapshot): Wallet {
    return new Wallet(
      snapshot.id,
      snapshot.playerId,
      snapshot.currency,
      snapshot.balance,
      snapshot.version,
      snapshot.createdAt,
      snapshot.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  /** Debita (aposta). Saldo insuficiente → `InsufficientFundsError`. */
  debit(params: WalletMutationParams): WalletLedgerEntry {
    if (this._balance.isLessThan(params.money)) {
      throw new InsufficientFundsError();
    }
    return this.applyMovement(LedgerDirection.Debit, params);
  }

  /** Credita (prêmio, reembolso). */
  credit(params: WalletMutationParams): WalletLedgerEntry {
    return this.applyMovement(LedgerDirection.Credit, params);
  }

  /**
   * Reverte um lançamento anterior na direção dada. Débito de reversão sem saldo →
   * `ReversalInsufficientFundsError` (distinto da aposta, spec §9).
   */
  reverse(params: ReverseParams): WalletLedgerEntry {
    if (params.direction === LedgerDirection.Debit && this._balance.isLessThan(params.money)) {
      throw new ReversalInsufficientFundsError();
    }
    return this.applyMovement(params.direction, params);
  }

  private applyMovement(
    direction: LedgerDirection,
    params: WalletMutationParams,
  ): WalletLedgerEntry {
    const entry = WalletLedgerEntry.create({
      id: params.entryId,
      walletId: this.id,
      transactionId: params.transactionId,
      direction,
      money: params.money,
      balanceBefore: this._balance,
      walletVersion: this._version + 1,
      at: params.at,
    });
    this._balance = entry.balanceAfter;
    this._version += 1;
    this._updatedAt = params.at;
    return entry;
  }
}
