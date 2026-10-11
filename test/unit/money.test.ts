import { describe, expect, test } from "bun:test";
import {
  CurrencyMismatchError,
  InvalidMoneyError,
  Money,
} from "../../src/shared/domain/money";

describe("Money.from — valid inputs (ADR-003)", () => {
  const valid: ReadonlyArray<[string, bigint]> = [
    ["0.00", 0n],
    ["0.01", 1n],
    ["0.99", 99n],
    ["1.00", 100n],
    ["25.00", 2500n],
    ["25.50", 2550n],
    ["1000.00", 100_000n],
    ["999999999999999999.99", 99_999_999_999_999_999_999n],
  ];

  for (const [amount, units] of valid) {
    test(`accepts "${amount}" as ${units} units`, () => {
      const money = Money.from({ amount, currency: "BRL" });
      expect(money.toUnits()).toBe(units);
      expect(money.toString()).toBe(amount);
      expect(money.currency).toBe("BRL");
    });
  }
});

describe("Money.from — invalid amounts are rejected, never rounded (AGENTS §5.1)", () => {
  const invalid: ReadonlyArray<[string, unknown]> = [
    ["integer without decimals", "25"],
    ["one decimal", "25.5"],
    ["three decimals", "25.001"],
    ["empty string", ""],
    ["leading space", " 1.00"],
    ["trailing space", "1.00 "],
    ["negative", "-1.00"],
    ["explicit plus", "+1.00"],
    ["leading zero", "01.00"],
    ["missing integer part", ".50"],
    ["scientific notation", "1e3"],
    ["NaN literal", "NaN"],
    ["Infinity literal", "Infinity"],
    ["comma separator", "25,00"],
    ["number type", 25.0],
    ["integer number type", 25],
    ["null", null],
    ["undefined", undefined],
    ["bigint", 25n],
    ["over NUMERIC(20,2)", "1000000000000000000.00"],
  ];

  for (const [label, amount] of invalid) {
    test(`rejects ${label}`, () => {
      expect(() => Money.from({ amount: amount as string, currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
    });
  }
});

describe("Money.from — currency validation", () => {
  const invalidCurrencies = ["br", "BRLL", "Br1", "brl", "123", "", "BR"];
  for (const currency of invalidCurrencies) {
    test(`rejects currency "${currency}"`, () => {
      expect(() => Money.from({ amount: "1.00", currency })).toThrow(InvalidMoneyError);
    });
  }

  test("accepts any three uppercase letters", () => {
    expect(Money.from({ amount: "1.00", currency: "USD" }).currency).toBe("USD");
  });
});

describe("Money arithmetic", () => {
  const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });

  test("add sums exact units", () => {
    expect(brl("10.00").add(brl("0.99")).toString()).toBe("10.99");
  });

  test("subtract can produce a negative value for internal use", () => {
    const result = brl("10.00").subtract(brl("25.50"));
    expect(result.isNegative()).toBe(true);
    expect(result.toString()).toBe("-15.50");
  });

  test("negate flips the sign", () => {
    expect(brl("10.00").negate().toString()).toBe("-10.00");
    expect(brl("0.00").negate().toString()).toBe("0.00");
  });

  test("predicates reflect the sign", () => {
    expect(brl("0.00").isZero()).toBe(true);
    expect(brl("0.01").isPositive()).toBe(true);
    expect(brl("0.01").isNegative()).toBe(false);
  });

  test("isLessThan compares magnitude", () => {
    expect(brl("10.00").isLessThan(brl("10.01"))).toBe(true);
    expect(brl("10.01").isLessThan(brl("10.00"))).toBe(false);
    expect(brl("10.00").isLessThan(brl("10.00"))).toBe(false);
  });

  test("equals requires same amount and currency", () => {
    expect(brl("10.00").equals(brl("10.00"))).toBe(true);
    expect(brl("10.00").equals(brl("10.01"))).toBe(false);
    expect(brl("10.00").equals(Money.from({ amount: "10.00", currency: "USD" }))).toBe(false);
  });
});

describe("Money — cross-currency operations raise", () => {
  const brl = Money.from({ amount: "10.00", currency: "BRL" });
  const usd = Money.from({ amount: "10.00", currency: "USD" });

  test("add", () => {
    expect(() => brl.add(usd)).toThrow(CurrencyMismatchError);
  });
  test("subtract", () => {
    expect(() => brl.subtract(usd)).toThrow(CurrencyMismatchError);
  });
  test("isLessThan", () => {
    expect(() => brl.isLessThan(usd)).toThrow(CurrencyMismatchError);
  });
});

describe("Money serialization", () => {
  test("toJSON always carries two decimals and the currency", () => {
    expect(Money.from({ amount: "25.00", currency: "BRL" }).toJSON()).toEqual({
      amount: "25.00",
      currency: "BRL",
    });
  });

  test("zero and fromUnits round-trip through the string form", () => {
    expect(Money.zero("BRL").toString()).toBe("0.00");
    expect(Money.fromUnits(2550n, "BRL").toString()).toBe("25.50");
    expect(Money.fromUnits(99_999_999_999_999_999_999n, "BRL").toString()).toBe(
      "999999999999999999.99",
    );
  });
});
