import { MikroORM } from "@mikro-orm/postgresql";
import { loadConfig } from "../../src/shared/infra/config/app-config";
import { buildOrmConfig } from "../../src/shared/infra/persistence/orm";
import { TEST_DATABASE_URL, uniqueSuffix, withDatabaseName } from "./env";

export interface TestDatabase {
  readonly orm: MikroORM;
  readonly databaseUrl: string;
  readonly databaseName: string;
  close(): Promise<void>;
}

function ormFor(url: string): Promise<MikroORM> {
  const config = loadConfig({ ...process.env, DATABASE_URL: url });
  return MikroORM.init(buildOrmConfig(config));
}

/**
 * Cria um banco descartável por arquivo de teste, aplica as migrations **reais** e devolve o ORM.
 * Banco (em vez de schema) porque as migrations criam tabelas sem qualificar o schema e o
 * `search_path` do MikroORM mantém `public`; um banco por arquivo garante isolamento total.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const databaseName = `wagering_test_${uniqueSuffix()}`;
  const maintenance = await ormFor(TEST_DATABASE_URL);
  try {
    await maintenance.em.getConnection().execute(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await maintenance.close(true);
  }

  const databaseUrl = withDatabaseName(TEST_DATABASE_URL, databaseName);
  const orm = await ormFor(databaseUrl);
  await orm.getMigrator().up();

  return {
    orm,
    databaseUrl,
    databaseName,
    async close(): Promise<void> {
      await orm.close(true);
      const admin = await ormFor(TEST_DATABASE_URL);
      try {
        await admin.em.getConnection().execute(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      } finally {
        await admin.close(true);
      }
    },
  };
}
