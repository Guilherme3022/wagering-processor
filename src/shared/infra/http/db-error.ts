/** Códigos de erro do PostgreSQL relevantes para a classificação (spec §6, §9). */
export const PG_UNIQUE_VIOLATION = "23505";
export const PG_LOCK_NOT_AVAILABLE = "55P03";

const TRANSIENT_PG_CODES: ReadonlySet<string> = new Set([
  PG_LOCK_NOT_AVAILABLE, // lock_timeout
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "08000", // connection_exception
  "08003", // connection_does_not_exist
  "08006", // connection_failure
  "57P01", // admin_shutdown
  "57P03", // cannot_connect_now
  "53300", // too_many_connections
]);

/** Extrai o `code` do PostgreSQL de um erro do MikroORM, percorrendo a cadeia de `cause`. */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    if (typeof current === "object" && "code" in current) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string") {
        return code;
      }
    }
    current = typeof current === "object" ? (current as { cause?: unknown }).cause : undefined;
  }
  return undefined;
}

export function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === PG_UNIQUE_VIOLATION;
}

/**
 * Descritor seguro de um erro para log (spec §12): nome, código do PostgreSQL e constraint, nunca
 * a `message` crua — a mensagem do ORM traz o SQL completo com valores monetários e `playerId`.
 */
export function describeError(error: unknown): { name: string; code?: string; constraint?: string } {
  const name =
    typeof error === "object" && error !== null && typeof (error as { name?: unknown }).name === "string"
      ? (error as { name: string }).name
      : typeof error;
  const code = pgErrorCode(error);
  const constraint = pgConstraint(error);
  return { name, ...(code === undefined ? {} : { code }), ...(constraint === undefined ? {} : { constraint }) };
}

/** Nome da constraint violada (quando o driver informa), para distinguir o tipo de conflito. */
export function pgConstraint(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    if (typeof current === "object" && "constraint" in current) {
      const constraint = (current as { constraint?: unknown }).constraint;
      if (typeof constraint === "string") {
        return constraint;
      }
    }
    current = typeof current === "object" ? (current as { cause?: unknown }).cause : undefined;
  }
  return undefined;
}

/** Erro transitório de infraestrutura: vira 503 / retry do SQS, nunca 500. */
export function isTransientDbError(error: unknown): boolean {
  const code = pgErrorCode(error);
  if (code !== undefined && TRANSIENT_PG_CODES.has(code)) {
    return true;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("econnrefused") || message.includes("connection terminated");
}

const TRANSIENT_NAME_HINTS = [
  "throttl",
  "timeout",
  "serviceunavailable",
  "service unavailable",
  "econnreset",
  "econnrefused",
  "socket hang up",
  "networkingerror",
  "requestthrottled",
];

/** Erro transitório de infra (PostgreSQL **ou** transporte do SQS): retry, nunca DLQ/500. */
export function isTransientError(error: unknown): boolean {
  if (isTransientDbError(error)) {
    return true;
  }
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const name = typeof (error as { name?: unknown }).name === "string" ? (error as { name: string }).name.toLowerCase() : "";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return TRANSIENT_NAME_HINTS.some((hint) => name.includes(hint) || message.includes(hint));
}

/** Violação de invariante levantada por trigger (`invariant_violation:`): é bug → 500. */
export function isInvariantViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return message.includes("invariant_violation:");
}
