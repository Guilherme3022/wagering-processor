import { Migrator } from "@mikro-orm/migrations";
import { defineConfig, type Options } from "@mikro-orm/postgresql";
import { type AppConfig } from "../config/app-config";

/**
 * Configuração do MikroORM. Usamos o ORM para pool de conexões, `em.transactional()`
 * (BEGIN/COMMIT) e migrations; as operações financeiras rodam SQL explícito pelo mesmo
 * EntityManager, porque a correção depende de `FOR UPDATE`, UPDATE condicionado por versão
 * e `ON CONFLICT` — mais claros em SQL do que no unit of work (ver §15 da tech spec).
 */
export function buildOrmConfig(config: AppConfig): Options {
  return defineConfig({
    clientUrl: config.database.url,
    pool: { min: 2, max: config.database.poolMax },
    entities: [],
    discovery: { warnWhenNoEntities: false, requireEntitiesArray: true },
    migrations: {
      path: "./migrations",
      pathTs: "./migrations",
      emit: "ts",
      snapshot: false,
      transactional: true,
      allOrNothing: true,
    },
    extensions: [Migrator],
    forceUtcTimezone: true,
    debug: false,
  });
}
