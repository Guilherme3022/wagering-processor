import { Global, Module } from "@nestjs/common";
import { MikroORM } from "@mikro-orm/postgresql";
import { UNIT_OF_WORK } from "../../application/persistence";
import { type AppConfig } from "../config/app-config";
import { APP_CONFIG } from "../config/config.module";
import { Database } from "./database";
import { buildOrmConfig } from "./orm";
import { SqlUnitOfWork } from "./sql-unit-of-work";

/** Fornece o `Database` (ORM) e a `UnitOfWork` SQL para toda a aplicação (spec §2.1, §5). */
@Global()
@Module({
  providers: [
    {
      provide: Database,
      useFactory: async (config: AppConfig): Promise<Database> =>
        new Database(await MikroORM.init(buildOrmConfig(config)), config.shutdownGraceMs),
      inject: [APP_CONFIG],
    },
    { provide: UNIT_OF_WORK, useClass: SqlUnitOfWork },
  ],
  exports: [Database, UNIT_OF_WORK],
})
export class PersistenceModule {}
