import { LedgerDirection } from "../../wallet/domain/ledger-direction";

/** Tipos de operação de aposta (spec §3.4). `OPENING` é interno (`POST /wallets`). */
export const WagerKind = {
  Opening: "OPENING",
  Bet: "BET",
  Win: "WIN",
  Loss: "LOSS",
  Refund: "REFUND",
  Rollback: "ROLLBACK",
} as const;

export type WagerKind = (typeof WagerKind)[keyof typeof WagerKind];

const REQUIRE_REFERENCE: ReadonlySet<WagerKind> = new Set([WagerKind.Refund, WagerKind.Rollback]);
const FORBID_REFERENCE: ReadonlySet<WagerKind> = new Set([WagerKind.Bet, WagerKind.Opening]);
// Kinds que uma referência pode apontar (spec §3.4): REFUND só a BET; ROLLBACK a BET/WIN/REFUND.
const REFUND_TARGETS: ReadonlySet<WagerKind> = new Set([WagerKind.Bet]);
const ROLLBACK_TARGETS: ReadonlySet<WagerKind> = new Set([
  WagerKind.Bet,
  WagerKind.Win,
  WagerKind.Refund,
]);

/** `REFUND`/`ROLLBACK` exigem referência; ausência é `REFERENCE_REQUIRED` na borda. */
export function requiresReference(kind: WagerKind): boolean {
  return REQUIRE_REFERENCE.has(kind);
}

/** `BET`/`OPENING` não aceitam referência; presença é `INVALID_PAYLOAD` na borda. */
export function forbidsReference(kind: WagerKind): boolean {
  return FORBID_REFERENCE.has(kind);
}

/** O kind compensador aceita apontar para o kind da referência (spec §3.4, regra 5). */
export function acceptsReferenceKind(kind: WagerKind, referenceKind: WagerKind): boolean {
  if (kind === WagerKind.Refund) {
    return REFUND_TARGETS.has(referenceKind);
  }
  if (kind === WagerKind.Rollback) {
    return ROLLBACK_TARGETS.has(referenceKind);
  }
  // WIN/LOSS com referência opcional só aceitam BET (spec §3.4).
  return referenceKind === WagerKind.Bet;
}

/** Direção de um `ROLLBACK` = inverso do lançamento da referência (spec §3.4). */
export function inverseDirection(direction: LedgerDirection): LedgerDirection {
  return direction === LedgerDirection.Credit ? LedgerDirection.Debit : LedgerDirection.Credit;
}
