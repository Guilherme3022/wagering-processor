/** Promessa que resolve após `ms`. Usada pelos loops de worker entre ciclos ociosos. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Espera `promise` por no máximo `ms`, mas **limpa o timer** assim que ela resolve — sem deixar um
 * `setTimeout` pendurado segurando o event loop. Usado para limitar o shutdown pelo grace.
 */
export async function withDeadline(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([promise.then(() => undefined), timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
