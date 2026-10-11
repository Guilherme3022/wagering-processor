import { type FailureCode } from "../../domain/failure-code";

export interface FieldError {
  readonly path: string;
  readonly message: string;
}

/** Corpo `application/problem+json` (spec §7). `code` é estável; `retryable` guia o provedor. */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: FailureCode;
  readonly retryable: boolean;
  readonly correlationId: string;
  readonly errors?: readonly FieldError[];
}

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

export function buildProblem(params: {
  status: number;
  code: FailureCode;
  retryable: boolean;
  correlationId: string;
  title?: string;
  errors?: readonly FieldError[];
}): ProblemDetails {
  const slug = params.code.toLowerCase().replace(/_/g, "-");
  const problem: ProblemDetails = {
    type: `https://errors.wagering.local/${slug}`,
    title: params.title ?? params.code,
    status: params.status,
    code: params.code,
    retryable: params.retryable,
    correlationId: params.correlationId,
  };
  return params.errors === undefined ? problem : { ...problem, errors: params.errors };
}
