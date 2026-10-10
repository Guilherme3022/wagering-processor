/**
 * Códigos estáveis e legíveis por máquina que o provedor usa para decidir se reenvia,
 * corrige o payload ou desiste. A tabela com HTTP e ação esperada está na spec §9.
 */
export const FailureCode = {
  InvalidPayload: "INVALID_PAYLOAD",
  ReferenceRequired: "REFERENCE_REQUIRED",
  IdempotencyKeyConflict: "IDEMPOTENCY_KEY_CONFLICT",
  DuplicateExternalTransaction: "DUPLICATE_EXTERNAL_TRANSACTION",
  WalletAlreadyExists: "WALLET_ALREADY_EXISTS",
  WalletNotFound: "WALLET_NOT_FOUND",
  WalletPlayerMismatch: "WALLET_PLAYER_MISMATCH",
  CurrencyMismatch: "CURRENCY_MISMATCH",
  InsufficientFunds: "INSUFFICIENT_FUNDS",
  ReversalInsufficientFunds: "REVERSAL_INSUFFICIENT_FUNDS",
  InvalidReferenceKind: "INVALID_REFERENCE_KIND",
  ReferenceMismatch: "REFERENCE_MISMATCH",
  ReferenceNotProcessed: "REFERENCE_NOT_PROCESSED",
  AmountMismatch: "AMOUNT_MISMATCH",
  ReferenceAlreadyReversed: "REFERENCE_ALREADY_REVERSED",
  ReferenceNotFound: "REFERENCE_NOT_FOUND",
  ProcessingFailed: "PROCESSING_FAILED",
  InfraUnavailable: "INFRA_UNAVAILABLE",
  InternalError: "INTERNAL_ERROR",
} as const;

export type FailureCode = (typeof FailureCode)[keyof typeof FailureCode];
