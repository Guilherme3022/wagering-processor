import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../src/app.module";
import { createTestDatabase, type TestDatabase } from "./database";
import { TEST_AWS_ENDPOINT } from "./env";

export interface TestApp {
  readonly baseUrl: string;
  readonly db: TestDatabase;
  request(path: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

/**
 * Sobe a app Nest real contra um banco descartável (migrations reais) numa porta efêmera.
 * A app usa seu próprio ORM (via `DATABASE_URL`); `db.orm` serve às asserções do teste.
 */
export async function startTestApp(): Promise<TestApp> {
  const db = await createTestDatabase();
  process.env.DATABASE_URL = db.databaseUrl;
  process.env.AWS_ENDPOINT_URL = TEST_AWS_ENDPOINT;
  // Por padrão os workers (outbox/consumer) ficam desligados; testes de mensageria ligam explicitamente.
  process.env.WORKERS_ENABLED = "false";

  const app = await NestFactory.create(AppModule, { logger: false });
  app.enableShutdownHooks();
  await app.listen(0);
  const baseUrl = (await app.getUrl()).replace("[::1]", "127.0.0.1").replace("://::1", "://127.0.0.1");

  return {
    baseUrl,
    db,
    request(path: string, init?: RequestInit): Promise<Response> {
      return fetch(`${baseUrl}${path}`, init);
    },
    async close(): Promise<void> {
      await app.close();
      await db.close();
    },
  };
}

/** Atalho para `POST` com JSON e headers opcionais. */
export function postJson(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}
