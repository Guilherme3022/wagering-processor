import { type MikroORM } from "@mikro-orm/postgresql";
import { loadConfig } from "../../src/shared/infra/config/app-config";
import { Database } from "../../src/shared/infra/persistence/database";
import { SqlUnitOfWork } from "../../src/shared/infra/persistence/sql-unit-of-work";
import { SystemClock } from "../../src/shared/infra/system-clock";
import { UuidV7IdGenerator } from "../../src/shared/infra/uuid-v7-id-generator";
import { OpenWallet } from "../../src/wallet/application/open-wallet";
import { PayloadHasher } from "../../src/wagering/domain/payload-hasher";
import { SubmitWagerTransaction } from "../../src/wagering/application/submit-wager-transaction";
import { TEST_DATABASE_URL } from "./env";

/** Monta `SubmitWagerTransaction` e `OpenWallet` sobre o ORM do teste (sem subir a app Nest). */
export function buildUseCases(orm: MikroORM): { submit: SubmitWagerTransaction; openWallet: OpenWallet } {
  const config = loadConfig({ ...process.env, DATABASE_URL: TEST_DATABASE_URL });
  const uow = new SqlUnitOfWork(new Database(orm), config);
  const ids = new UuidV7IdGenerator();
  const clock = new SystemClock();
  const hasher = new PayloadHasher();
  return {
    submit: new SubmitWagerTransaction(uow, ids, clock, config.pendingReference.ttlMs, hasher),
    openWallet: new OpenWallet(uow, ids, clock, hasher),
  };
}
