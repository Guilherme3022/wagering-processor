import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Injectable,
} from "@nestjs/common";
import { type Response } from "express";
import { ZodError } from "zod";
import { BusinessRuleError, InvariantViolationError } from "../../domain/domain-error";
import { FailureCode } from "../../domain/failure-code";
import { CorrelationService } from "../correlation";
import { LoggerService } from "../logger";
import { MetricsService } from "../metrics";
import { AppError } from "./app-error";
import {
  describeError,
  isInvariantViolation,
  isTransientDbError,
  isUniqueViolation,
  PG_LOCK_NOT_AVAILABLE,
  pgConstraint,
  pgErrorCode,
} from "./db-error";
import { failureCodeHttp } from "./failure-http";
import { buildProblem, PROBLEM_CONTENT_TYPE, type FieldError } from "./problem";

/** Converte toda exceção não tratada em `application/problem+json` consistente (spec §7). */
@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly correlation: CorrelationService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const correlationId = this.correlation.correlationId() ?? "unknown";

    if (pgErrorCode(exception) === PG_LOCK_NOT_AVAILABLE) {
      this.metrics.lockConflicts.inc();
    }
    const mapped = this.map(exception);
    // Só logamos como erro o que é bug de verdade (500); 503/transitório é esperado.
    if (mapped.status >= 500 && !mapped.retryable) {
      this.logger.error("request failed with an unexpected error", {
        code: mapped.code,
        error: describeError(exception),
      });
    }

    if (mapped.retryAfterSeconds !== undefined) {
      response.setHeader("Retry-After", String(mapped.retryAfterSeconds));
    }
    response
      .status(mapped.status)
      .type(PROBLEM_CONTENT_TYPE)
      .send(
        buildProblem({
          status: mapped.status,
          code: mapped.code,
          retryable: mapped.retryable,
          correlationId,
          title: mapped.title,
          ...(mapped.errors ? { errors: mapped.errors } : {}),
        }),
      );
  }

  private map(exception: unknown): {
    status: number;
    code: FailureCode;
    retryable: boolean;
    title: string;
    errors?: readonly FieldError[];
    retryAfterSeconds?: number;
  } {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        code: exception.code,
        retryable: exception.retryable,
        title: exception.message,
        ...(exception.fieldErrors ? { errors: exception.fieldErrors } : {}),
        ...(exception.status === 503 ? { retryAfterSeconds: 1 } : {}),
      };
    }
    if (exception instanceof ZodError) {
      return {
        status: 400,
        code: FailureCode.InvalidPayload,
        retryable: false,
        title: "Invalid payload",
        errors: exception.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      };
    }
    if (exception instanceof BusinessRuleError) {
      const http = failureCodeHttp(exception.failureCode);
      return {
        status: http.status,
        code: exception.failureCode,
        retryable: http.retryable,
        title: exception.message,
      };
    }
    if (isInvariantViolation(exception) || exception instanceof InvariantViolationError) {
      return { status: 500, code: FailureCode.InternalError, retryable: false, title: "Internal error" };
    }
    if (isUniqueViolation(exception)) {
      // Só constraints conhecidas de conflito viram 409; outras violações de unicidade são bug (500).
      const constraint = pgConstraint(exception);
      if (constraint === "uq_wtx_idempotency_key") {
        return { status: 409, code: FailureCode.IdempotencyKeyConflict, retryable: false, title: "Conflict" };
      }
      if (constraint === "uq_wtx_provider_external") {
        return { status: 409, code: FailureCode.DuplicateExternalTransaction, retryable: false, title: "Conflict" };
      }
      if (constraint === "uq_wallets_player_currency") {
        return { status: 409, code: FailureCode.WalletAlreadyExists, retryable: false, title: "Conflict" };
      }
    }
    if (isTransientDbError(exception)) {
      return {
        status: 503,
        code: FailureCode.InfraUnavailable,
        retryable: true,
        title: "Infrastructure unavailable",
        retryAfterSeconds: 1,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === 503) {
        return { status, code: FailureCode.InfraUnavailable, retryable: true, title: "Infrastructure unavailable", retryAfterSeconds: 1 };
      }
      return {
        status,
        code: status === 404 ? FailureCode.InternalError : FailureCode.InvalidPayload,
        retryable: false,
        title: exception.message,
      };
    }
    return { status: 500, code: FailureCode.InternalError, retryable: false, title: "Internal error" };
  }
}
