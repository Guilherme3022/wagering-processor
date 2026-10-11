/** Fonte do tempo atual. Injetável para que testes controlem prazos e backoff (ADR-004). */
export interface Clock {
  now(): Date;
}

/** Token de injeção da porta `Clock` (a infra registra a implementação real). */
export const CLOCK = Symbol("CLOCK");
