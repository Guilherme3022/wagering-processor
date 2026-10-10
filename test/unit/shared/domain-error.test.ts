import { describe, expect, test } from "bun:test";
import {
  BusinessRuleError,
  DomainError,
  InvariantViolationError,
} from "../../../src/shared/domain/domain-error";
import { FailureCode } from "../../../src/shared/domain/failure-code";

class SampleRuleError extends BusinessRuleError {
  readonly failureCode = FailureCode.InsufficientFunds;

  constructor() {
    super("balance is lower than the bet");
  }
}

describe("domain errors", () => {
  test("business rule errors expose a stable failure code and their class name", () => {
    const error = new SampleRuleError();

    expect(error).toBeInstanceOf(DomainError);
    expect(error.failureCode).toBe("INSUFFICIENT_FUNDS");
    expect(error.name).toBe("SampleRuleError");
  });

  test("invariant violations are domain errors but not business rules", () => {
    const error = new InvariantViolationError("terminal transaction cannot change state");

    expect(error).toBeInstanceOf(DomainError);
    expect(error).not.toBeInstanceOf(BusinessRuleError);
    expect(error.name).toBe("InvariantViolationError");
  });
});
