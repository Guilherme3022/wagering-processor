/**
 * Backoff exponencial em ms: `min(baseMs × 2^attempts, maxMs)`, com jitter opcional de ±ratio.
 * Puro (sem relógio nem infra); usado pela outbox (ADR-009) e pelo worker de referência (ADR-004).
 */
export function exponentialBackoffMs(params: {
  attempts: number;
  baseMs: number;
  maxMs: number;
  jitterRatio?: number;
}): number {
  const capped = Math.min(params.baseMs * 2 ** params.attempts, params.maxMs);
  const jitterRatio = params.jitterRatio ?? 0;
  if (jitterRatio === 0) {
    return capped;
  }
  const delta = capped * jitterRatio;
  return Math.round(capped - delta + Math.random() * 2 * delta);
}
