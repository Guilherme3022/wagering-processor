import { FailureCode } from "../../domain/failure-code";
import { type FieldError } from "./problem";

/**
 * Erro que vira resposta HTTP (não é rejeição de negócio persistida). Carrega status, `code`
 * estável e `retryable`. Rejeições de negócio (`REJECTED`) não passam por aqui: são persistidas
 * e devolvidas no corpo normal da transação (spec §7.1).
 */
export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: FailureCode;
  abstract readonly retryable: boolean;
  readonly fieldErrors: readonly FieldError[] | undefined;

  protected constructor(message: string, fieldErrors?: readonly FieldError[]) {
    super(message);
    this.name = new.target.name;
    this.fieldErrors = fieldErrors;
  }
}

/** Payload, header ou query inválido → 400. */
export class ValidationError extends AppError {
  readonly status = 400;
  readonly code = FailureCode.InvalidPayload;
  readonly retryable = false;

  constructor(message: string, fieldErrors?: readonly FieldError[]) {
    super(message, fieldErrors);
  }
}

/** `REFUND`/`ROLLBACK` sem referência → 400 (código distinto para o provedor). */
export class ReferenceRequiredError extends AppError {
  readonly status = 400;
  readonly code = FailureCode.ReferenceRequired;
  readonly retryable = false;

  constructor() {
    super("REFUND and ROLLBACK require referenceExternalTransactionId");
  }
}

/** Recurso inexistente em `GET` → 404. */
export class NotFoundError extends AppError {
  readonly status = 404;
  readonly code = FailureCode.InternalError;
  readonly retryable = false;

  constructor(message: string) {
    super(message);
  }
}

/** Conflito de idempotência ou duplicidade → 409. */
export class ConflictError extends AppError {
  readonly status = 409;
  readonly retryable = false;

  constructor(
    readonly code: FailureCode,
    message: string,
  ) {
    super(message);
  }
}

/** Infra indisponível ou `lock_timeout` → 503, reenviar com backoff. */
export class InfraUnavailableError extends AppError {
  readonly status = 503;
  readonly code = FailureCode.InfraUnavailable;
  readonly retryable = true;

  constructor(message: string) {
    super(message);
  }
}
