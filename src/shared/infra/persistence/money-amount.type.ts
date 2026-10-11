import { Type } from "@mikro-orm/core";

const UNITS_PER_WHOLE = 100n;

/**
 * Converte `NUMERIC(20,2)` ↔ `bigint` em centavos sem nunca passar por ponto flutuante (ADR-006).
 * O driver `pg` entrega `NUMERIC` como string; esta classe faz a aritmética em `bigint` direto
 * sobre os dígitos, então `999999999999999999.99` sobrevive ao round-trip sem perda.
 */
export class MoneyAmountType extends Type<bigint, string> {
  override convertToDatabaseValue(value: bigint | string): string {
    const units = typeof value === "bigint" ? value : BigInt(value);
    const negative = units < 0n;
    const abs = negative ? -units : units;
    const whole = abs / UNITS_PER_WHOLE;
    const fraction = (abs % UNITS_PER_WHOLE).toString().padStart(2, "0");
    return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
  }

  override convertToJSValue(value: string | bigint): bigint {
    if (typeof value === "bigint") {
      return value;
    }
    const dot = value.indexOf(".");
    if (dot === -1) {
      return BigInt(value) * UNITS_PER_WHOLE;
    }
    const whole = value.slice(0, dot);
    const fraction = value.slice(dot + 1).padEnd(2, "0").slice(0, 2);
    const negative = whole.startsWith("-");
    const magnitude = BigInt(whole.replace("-", "")) * UNITS_PER_WHOLE + BigInt(fraction);
    return negative ? -magnitude : magnitude;
  }

  override getColumnType(): string {
    return "numeric(20,2)";
  }

  override compareAsType(): string {
    return "string";
  }
}
