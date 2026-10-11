import { describe, expect, test } from "bun:test";
import { MoneyAmountType } from "../../src/shared/infra/persistence/money-amount.type";

const type = new MoneyAmountType();

describe("MoneyAmountType — NUMERIC(20,2) ↔ bigint without floats (ADR-006)", () => {
  const cases: ReadonlyArray<[bigint, string]> = [
    [0n, "0.00"],
    [1n, "0.01"],
    [2500n, "25.00"],
    [97_500n, "975.00"],
    [99_999_999_999_999_999_999n, "999999999999999999.99"],
    [-1550n, "-15.50"],
  ];

  for (const [units, db] of cases) {
    test(`${units} units serializes to "${db}"`, () => {
      expect(type.convertToDatabaseValue(units)).toBe(db);
    });
    test(`"${db}" parses back to ${units} units`, () => {
      expect(type.convertToJSValue(db)).toBe(units);
    });
  }

  test("round-trips the largest value without loss", () => {
    const units = 99_999_999_999_999_999_999n;
    expect(type.convertToJSValue(type.convertToDatabaseValue(units))).toBe(units);
  });

  test("declares the numeric(20,2) column type", () => {
    expect(type.getColumnType()).toBe("numeric(20,2)");
  });
});
