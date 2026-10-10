/** Fonte do tempo atual. Injetável para que testes controlem prazos e backoff (ADR-004). */
export interface Clock {
  now(): Date;
}
