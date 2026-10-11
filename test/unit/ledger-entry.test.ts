import { describe, expect, test } from "bun:test";
import { InvariantViolationError } from "../../src/shared/domain/domain-error";
import { Money } from "../../src/shared/domain/money";
import { LedgerDirection } from "../../src/wallet/domain/ledger-direction";
import { WalletLedgerEntry } from "../../src/wallet/domain/wallet-ledger-entry";

const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });

const base = {
  id: "entry-1",
  walletId: "wallet-1",
  transactionId: "tx-1",
  walletVersion: 2,
  at: new Date("2026-01-01T00:00:00.000Z"),
};

describe("WalletLedgerEntry.create — arithmetic validated at the factory (spec §3.3)", () => {
  test("credit derives balanceAfter = before + money", () => {
    const entry = WalletLedgerEntry.create({
      ...base,
      direction: LedgerDirection.Credit,
      money: brl("25.00"),
      balanceBefore: brl("100.00"),
    });
    expect(entry.balanceAfter.toString()).toBe("125.00");
  });

  test("debit derives balanceAfter = before - money", () => {
    const entry = WalletLedgerEntry.create({
      ...base,
      direction: LedgerDirection.Debit,
      money: brl("25.00"),
      balanceBefore: brl("100.00"),
    });
    expect(entry.balanceAfter.toString()).toBe("75.00");
  });

  test("rejects a non-positive amount", () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...base,
        direction: LedgerDirection.Credit,
        money: brl("0.00"),
        balanceBefore: brl("100.00"),
      }),
    ).toThrow(InvariantViolationError);
  });

  test("rejects a debit that would go negative", () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...base,
        direction: LedgerDirection.Debit,
        money: brl("100.01"),
        balanceBefore: brl("100.00"),
      }),
    ).toThrow(InvariantViolationError);
  });

  test("rejects a wallet version below 1", () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...base,
        walletVersion: 0,
        direction: LedgerDirection.Credit,
        money: brl("1.00"),
        balanceBefore: brl("0.00"),
      }),
    ).toThrow(InvariantViolationError);
  });

  test("cross-currency amount cannot be applied to the balance", () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...base,
        direction: LedgerDirection.Credit,
        money: Money.from({ amount: "1.00", currency: "USD" }),
        balanceBefore: brl("0.00"),
      }),
    ).toThrow();
  });
});
