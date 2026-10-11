/** Estados de uma `WagerTransaction` (spec §3.4). Três são terminais. */
export const WagerStatus = {
  Pending: "PENDING",
  PendingReference: "PENDING_REFERENCE",
  Processed: "PROCESSED",
  Rejected: "REJECTED",
  Failed: "FAILED",
} as const;

export type WagerStatus = (typeof WagerStatus)[keyof typeof WagerStatus];

const TERMINAL: ReadonlySet<WagerStatus> = new Set([
  WagerStatus.Processed,
  WagerStatus.Rejected,
  WagerStatus.Failed,
]);

export function isTerminal(status: WagerStatus): boolean {
  return TERMINAL.has(status);
}
