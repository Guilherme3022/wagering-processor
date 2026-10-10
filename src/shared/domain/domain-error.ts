import { type FailureCode } from "./failure-code";

/** Base de todos os erros lançados pelo domínio. Nunca lance `Error` genérico no domínio. */
export abstract class DomainError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Violação de regra de negócio. O caso de uso a transforma em transação `REJECTED`
 * com o `failureCode` correspondente; não é bug.
 */
export abstract class BusinessRuleError extends DomainError {
  abstract readonly failureCode: FailureCode;
}

/**
 * Estado que o domínio garante ser impossível (por exemplo, transicionar uma transação
 * terminal). Indica bug: sobe como HTTP 500 e log de erro, nunca como rejeição.
 */
export class InvariantViolationError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}
