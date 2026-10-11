import { BusinessRuleError } from "./domain-error";
import { FailureCode } from "./failure-code";

/** Forma serializada do dinheiro: strings exatas, nunca `number` nem `bigint` (spec §3.1). */
export interface MoneyProps {
  readonly amount: string;
  readonly currency: string;
}

/** Entrada de dinheiro rejeitada na borda: escala errada, não-string, moeda inválida (ADR-003). */
export class InvalidMoneyError extends BusinessRuleError {
  readonly failureCode = FailureCode.InvalidPayload;

  constructor(message: string) {
    super(message);
  }
}

/** Operação entre moedas diferentes. O agregado decide o efeito; aqui só proíbe a mistura. */
export class CurrencyMismatchError extends BusinessRuleError {
  readonly failureCode = FailureCode.CurrencyMismatch;

  constructor(left: string, right: string) {
    super(`cannot operate on ${left} and ${right}`);
  }
}

const SCALE = 2;
const UNITS_PER_WHOLE = 100n;
// Exatamente duas casas decimais, sem sinal, sem zeros à esquerda (ADR-003).
const AMOUNT_PATTERN = /^(0|[1-9]\d*)\.\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
// Cabe em NUMERIC(20,2): 999999999999999999.99 em centavos.
const MAX_UNITS = 99_999_999_999_999_999_999n;

/**
 * Valor monetário imutável, guardado como `bigint` em centavos com escala fixa 2 (ADR-006).
 * Nunca usa ponto flutuante. A entrada externa passa só por `from`, que valida a escala.
 */
export class Money {
  private constructor(
    private readonly units: bigint,
    private readonly _currency: string,
  ) {}

  /** Lê a forma externa `{amount, currency}`. Única porta de entrada validada. */
  static from(props: MoneyProps): Money {
    const { amount, currency } = props;
    if (typeof amount !== "string") {
      throw new InvalidMoneyError("amount must be a string with exactly two decimals");
    }
    if (!AMOUNT_PATTERN.test(amount)) {
      throw new InvalidMoneyError(`amount "${amount}" must match the pattern 0.00`);
    }
    const normalizedCurrency = Money.parseCurrency(currency);
    const units = Money.parseUnits(amount);
    if (units > MAX_UNITS) {
      throw new InvalidMoneyError(`amount "${amount}" exceeds the maximum of NUMERIC(20,2)`);
    }
    return new Money(units, normalizedCurrency);
  }

  /** Zero na moeda dada, sem passar pela regex (uso interno do domínio). */
  static zero(currency: string): Money {
    return new Money(0n, Money.parseCurrency(currency));
  }

  /** Reconstrói a partir do inteiro em centavos (persistência). Não revalida escala. */
  static fromUnits(units: bigint, currency: string): Money {
    return new Money(units, Money.parseCurrency(currency));
  }

  private static parseCurrency(currency: string): string {
    if (typeof currency !== "string" || !CURRENCY_PATTERN.test(currency)) {
      throw new InvalidMoneyError(`currency "${currency}" must match the pattern AAA`);
    }
    return currency;
  }

  private static parseUnits(amount: string): bigint {
    const dot = amount.indexOf(".");
    const whole = amount.slice(0, dot);
    const fraction = amount.slice(dot + 1);
    return BigInt(whole) * UNITS_PER_WHOLE + BigInt(fraction);
  }

  get currency(): string {
    return this._currency;
  }

  /** Centavos crus; só para persistência e asserções exatas, nunca para ponto flutuante. */
  toUnits(): bigint {
    return this.units;
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.units + other.units, this._currency);
  }

  /** Pode produzir valor negativo; quem decide se é permitido é o agregado (spec §3.1). */
  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.units - other.units, this._currency);
  }

  negate(): Money {
    return new Money(-this.units, this._currency);
  }

  isZero(): boolean {
    return this.units === 0n;
  }

  isPositive(): boolean {
    return this.units > 0n;
  }

  isNegative(): boolean {
    return this.units < 0n;
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.units < other.units;
  }

  equals(other: Money): boolean {
    return this._currency === other._currency && this.units === other.units;
  }

  private assertSameCurrency(other: Money): void {
    if (this._currency !== other._currency) {
      throw new CurrencyMismatchError(this._currency, other._currency);
    }
  }

  /** Representação decimal com escala fixa 2, com sinal quando negativo. */
  toString(): string {
    const negative = this.units < 0n;
    const abs = negative ? -this.units : this.units;
    const whole = abs / UNITS_PER_WHOLE;
    const fraction = (abs % UNITS_PER_WHOLE).toString().padStart(SCALE, "0");
    return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
  }

  toJSON(): MoneyProps {
    return { amount: this.toString(), currency: this._currency };
  }
}
