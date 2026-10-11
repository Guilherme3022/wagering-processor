/** Sentido de um lançamento no ledger: entra (CREDIT) ou sai (DEBIT) da wallet. */
export const LedgerDirection = {
  Debit: "DEBIT",
  Credit: "CREDIT",
} as const;

export type LedgerDirection = (typeof LedgerDirection)[keyof typeof LedgerDirection];
