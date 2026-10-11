import { BusinessRuleError } from "../../shared/domain/domain-error";
import { FailureCode } from "../../shared/domain/failure-code";

/** Mesma `Idempotency-Key` com payload diferente (spec §5.3). Vira HTTP 409. */
export class IdempotencyKeyConflictError extends BusinessRuleError {
  readonly failureCode = FailureCode.IdempotencyKeyConflict;

  constructor() {
    super("idempotency key already used with a different payload");
  }
}

/** Mesmo `(providerId, externalTransactionId)` com outra chave de idempotência. HTTP 409. */
export class DuplicateExternalTransactionError extends BusinessRuleError {
  readonly failureCode = FailureCode.DuplicateExternalTransaction;

  constructor() {
    super("provider transaction already recorded with a different idempotency key");
  }
}
