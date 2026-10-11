import { FailureCode } from "../../domain/failure-code";

interface HttpMapping {
  readonly status: number;
  readonly retryable: boolean;
}

/** Mapa `failureCode` → HTTP (spec §9). Usado para erros de negócio lançados na borda. */
const MAP: Record<FailureCode, HttpMapping> = {
  [FailureCode.InvalidPayload]: { status: 400, retryable: false },
  [FailureCode.ReferenceRequired]: { status: 400, retryable: false },
  [FailureCode.IdempotencyKeyConflict]: { status: 409, retryable: false },
  [FailureCode.DuplicateExternalTransaction]: { status: 409, retryable: false },
  [FailureCode.WalletAlreadyExists]: { status: 409, retryable: false },
  [FailureCode.WalletNotFound]: { status: 422, retryable: false },
  [FailureCode.WalletPlayerMismatch]: { status: 422, retryable: false },
  [FailureCode.CurrencyMismatch]: { status: 422, retryable: false },
  [FailureCode.InsufficientFunds]: { status: 422, retryable: false },
  [FailureCode.ReversalInsufficientFunds]: { status: 422, retryable: false },
  [FailureCode.InvalidReferenceKind]: { status: 422, retryable: false },
  [FailureCode.ReferenceMismatch]: { status: 422, retryable: false },
  [FailureCode.ReferenceNotProcessed]: { status: 422, retryable: false },
  [FailureCode.AmountMismatch]: { status: 422, retryable: false },
  [FailureCode.ReferenceAlreadyReversed]: { status: 422, retryable: false },
  [FailureCode.ReferenceNotFound]: { status: 422, retryable: false },
  [FailureCode.ProcessingFailed]: { status: 500, retryable: false },
  [FailureCode.InfraUnavailable]: { status: 503, retryable: true },
  [FailureCode.InternalError]: { status: 500, retryable: false },
};

export function failureCodeHttp(code: FailureCode): HttpMapping {
  return MAP[code];
}
