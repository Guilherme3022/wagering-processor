import { BusinessRuleError } from "../../shared/domain/domain-error";
import { FailureCode } from "../../shared/domain/failure-code";

/** Débito (aposta) que deixaria o saldo negativo. Rejeição de negócio, não bug. */
export class InsufficientFundsError extends BusinessRuleError {
  readonly failureCode = FailureCode.InsufficientFunds;

  constructor() {
    super("wallet balance is lower than the requested debit");
  }
}

/**
 * Reversão (ROLLBACK) que deixaria o saldo negativo. Distinta de `InsufficientFundsError`
 * porque pede escalonamento operacional, não desistência do provedor (spec §9).
 */
export class ReversalInsufficientFundsError extends BusinessRuleError {
  readonly failureCode = FailureCode.ReversalInsufficientFunds;

  constructor() {
    super("wallet balance is lower than the reversal debit");
  }
}

/** Já existe wallet para o par `(player, currency)`. Vira HTTP 409 (spec §6.3). */
export class WalletAlreadyExistsError extends BusinessRuleError {
  readonly failureCode = FailureCode.WalletAlreadyExists;

  constructor() {
    super("a wallet already exists for this player and currency");
  }
}
