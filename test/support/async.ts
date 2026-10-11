export interface EventuallyOptions {
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
}

/**
 * Repete `fn` até passar (sem lançar) ou estourar o prazo. Substitui `sleep` fixo nos testes
 * assíncronos (AGENTS §10): o teste espera a condição, não um tempo arbitrário.
 */
export async function eventually<T>(
  fn: () => Promise<T> | T,
  options: EventuallyOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const intervalMs = options.intervalMs ?? 25;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (Date.now() >= deadline) {
        throw lastError instanceof Error
          ? lastError
          : new Error(`eventually timed out: ${String(lastError)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

/** Dispara todas as funções o mais junto possível (barreira para testes de concorrência). */
export async function fireTogether<T>(tasks: ReadonlyArray<() => Promise<T>>): Promise<T[]> {
  return Promise.all(tasks.map((task) => task()));
}
