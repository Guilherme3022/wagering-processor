import { describe, expect, test } from "bun:test";
import { Money } from "../../src/shared/domain/money";
import { LedgerDirection } from "../../src/wallet/domain/ledger-direction";
import {
  InsufficientFundsError,
  ReversalInsufficientFundsError,
} from "../../src/wallet/domain/wallet-errors";
import { Wallet } from "../../src/wallet/domain/wallet";

const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });
const at = new Date("2026-01-01T00:00:00.000Z");

const openWith = (amount: string): ReturnType<typeof Wallet.open> =>
  Wallet.open({
    id: "wallet-1",
    playerId: "player-1",
    initialBalance: brl(amount),
    openingTransactionId: "opening-tx",
    openingEntryId: "opening-entry",
    at,
  });

describe("Wallet.open (spec §3.2)", () => {
  test("positive initial balance opens at version 1 with an OPENING credit", () => {
    const { wallet, openingEntry } = openWith("1000.00");
    expect(wallet.version).toBe(1);
    expect(wallet.balance.toString()).toBe("1000.00");
    expect(openingEntry?.direction).toBe(LedgerDirection.Credit);
    expect(openingEntry?.walletVersion).toBe(1);
    expect(openingEntry?.balanceBefore.toString()).toBe("0.00");
    expect(openingEntry?.balanceAfter.toString()).toBe("1000.00");
  });

  test("zero initial balance opens at version 1 with no ledger entry", () => {
    const { wallet, openingEntry } = openWith("0.00");
    expect(wallet.version).toBe(1);
    expect(wallet.balance.isZero()).toBe(true);
    expect(openingEntry).toBeUndefined();
  });
});

describe("Wallet.debit / credit", () => {
  test("debit reduces the balance, bumps the version, returns a DEBIT entry", () => {
    const { wallet } = openWith("100.00");
    const entry = wallet.debit({ entryId: "e2", transactionId: "t2", money: brl("25.00"), at });
    expect(wallet.balance.toString()).toBe("75.00");
    expect(wallet.version).toBe(2);
    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.walletVersion).toBe(2);
    expect(entry.balanceAfter.toString()).toBe("75.00");
  });

  test("credit increases the balance and bumps the version", () => {
    const { wallet } = openWith("100.00");
    wallet.credit({ entryId: "e2", transactionId: "t2", money: brl("50.00"), at });
    expect(wallet.balance.toString()).toBe("150.00");
    expect(wallet.version).toBe(2);
  });

  test("debit beyond the balance raises InsufficientFundsError and leaves state untouched", () => {
    const { wallet } = openWith("100.00");
    expect(() =>
      wallet.debit({ entryId: "e2", transactionId: "t2", money: brl("100.01"), at }),
    ).toThrow(InsufficientFundsError);
    expect(wallet.balance.toString()).toBe("100.00");
    expect(wallet.version).toBe(1);
  });

  test("debit of the whole balance is allowed", () => {
    const { wallet } = openWith("100.00");
    wallet.debit({ entryId: "e2", transactionId: "t2", money: brl("100.00"), at });
    expect(wallet.balance.isZero()).toBe(true);
  });

  test("a mismatched currency cannot touch the balance", () => {
    const { wallet } = openWith("100.00");
    expect(() =>
      wallet.credit({
        entryId: "e2",
        transactionId: "t2",
        money: Money.from({ amount: "1.00", currency: "USD" }),
        at,
      }),
    ).toThrow();
  });
});

describe("Wallet.reverse", () => {
  test("reverse as CREDIT undoes a bet", () => {
    const { wallet } = openWith("100.00");
    wallet.debit({ entryId: "e2", transactionId: "t2", money: brl("30.00"), at });
    const entry = wallet.reverse({
      entryId: "e3",
      transactionId: "t3",
      direction: LedgerDirection.Credit,
      money: brl("30.00"),
      at,
    });
    expect(wallet.balance.toString()).toBe("100.00");
    expect(entry.direction).toBe(LedgerDirection.Credit);
    expect(wallet.version).toBe(3);
  });

  test("reverse as DEBIT without funds raises ReversalInsufficientFundsError", () => {
    const { wallet } = openWith("10.00");
    expect(() =>
      wallet.reverse({
        entryId: "e2",
        transactionId: "t2",
        direction: LedgerDirection.Debit,
        money: brl("20.00"),
        at,
      }),
    ).toThrow(ReversalInsufficientFundsError);
  });
});
