import { InvariantViolationError } from "../../shared/domain/domain-error";
import { type WagerStatus } from "./wager-status";

/**
 * Transição a partir de estado terminal (ou qualquer transição impossível). É bug de
 * programação, não rejeição de negócio: sobe como HTTP 500 e log de erro (spec §3.4).
 */
export class InvalidTransactionStateError extends InvariantViolationError {
  constructor(from: WagerStatus, to: WagerStatus) {
    super(`cannot transition wager transaction from ${from} to ${to}`);
  }
}
