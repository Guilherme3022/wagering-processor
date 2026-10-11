/** Endpoints da infra de teste (docker-compose.test.yml). Sobrescreva via env se necessário. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://wagering:wagering@localhost:55432/wagering_test";

export const TEST_AWS_ENDPOINT = process.env.TEST_AWS_ENDPOINT ?? "http://localhost:54566";
export const TEST_AWS_REGION = process.env.AWS_REGION ?? "us-east-1";

/** Troca o nome do banco na URL mantendo credenciais e host (database-por-arquivo de teste). */
export function withDatabaseName(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

/** Nome único e válido de banco/fila por arquivo de teste. */
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
