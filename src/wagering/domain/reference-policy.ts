import { FailureCode } from "../../shared/domain/failure-code";
import { type Money } from "../../shared/domain/money";
import { LedgerDirection } from "../../wallet/domain/ledger-direction";
import { acceptsReferenceKind, inverseDirection, requiresReference, WagerKind } from "./wager-kind";
import { WagerStatus } from "./wager-status";
import { type WagerTransaction } from "./wager-transaction";

/** Lançamento que cada kind processável produziu, usado para inverter num `ROLLBACK`. */
export function referenceMovement(kind: WagerKind): LedgerDirection | null {
  switch (kind) {
    case WagerKind.Bet:
      return LedgerDirection.Debit;
    case WagerKind.Win:
    case WagerKind.Refund:
      return LedgerDirection.Credit;
    default:
      return null;
  }
}

export type ReferenceOutcome =
  | { readonly type: "pending" }
  | { readonly type: "rejected"; readonly failureCode: FailureCode }
  /** `direction` só para `REFUND`/`ROLLBACK`; `null` para `WIN`/`LOSS` (efeito vem do kind). */
  | { readonly type: "resolved"; readonly reference: WagerTransaction; readonly direction: LedgerDirection | null };

export interface ReferenceInput {
  readonly kind: WagerKind;
  readonly money: Money;
  readonly playerId: string;
  readonly walletId: string;
  readonly roundId: string | null;
  readonly reference: WagerTransaction | null;
  readonly alreadyCompensated: boolean;
}

/**
 * Resolve a referência de uma transação na ordem exata da spec §3.4 (primeira falha vence).
 * Função pura: as leituras (achar a referência, saber se já foi compensada) são feitas pela
 * aplicação e passadas aqui. Direção do `ROLLBACK` = inverso do lançamento da referência.
 */
export function resolveReference(input: ReferenceInput): ReferenceOutcome {
  const { reference, kind } = input;
  const isCompensation = kind === WagerKind.Refund || kind === WagerKind.Rollback;

  if (reference === null) {
    return { type: "pending" };
  }
  if (reference.status === WagerStatus.Pending || reference.status === WagerStatus.PendingReference) {
    return { type: "pending" };
  }
  if (!acceptsReferenceKind(kind, reference.kind)) {
    return { type: "rejected", failureCode: FailureCode.InvalidReferenceKind };
  }
  if (
    reference.playerId !== input.playerId ||
    (reference.walletId ?? "") !== input.walletId ||
    reference.money.currency !== input.money.currency ||
    reference.roundId !== input.roundId
  ) {
    return { type: "rejected", failureCode: FailureCode.ReferenceMismatch };
  }
  if (reference.status === WagerStatus.Rejected || reference.status === WagerStatus.Failed) {
    return { type: "rejected", failureCode: FailureCode.ReferenceNotProcessed };
  }
  if (isCompensation) {
    if (!reference.money.equals(input.money)) {
      return { type: "rejected", failureCode: FailureCode.AmountMismatch };
    }
    if (input.alreadyCompensated) {
      return { type: "rejected", failureCode: FailureCode.ReferenceAlreadyReversed };
    }
    const movement = referenceMovement(reference.kind);
    if (movement === null) {
      return { type: "rejected", failureCode: FailureCode.InvalidReferenceKind };
    }
    return { type: "resolved", reference, direction: inverseDirection(movement) };
  }
  return { type: "resolved", reference, direction: null };
}

/** Uma submissão precisa resolver referência? Sempre em `REFUND`/`ROLLBACK`; opcional em `WIN`/`LOSS`. */
export function needsReference(kind: WagerKind, hasReference: boolean): boolean {
  return requiresReference(kind) || hasReference;
}
