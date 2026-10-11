import { type MikroORM } from "@mikro-orm/postgresql";
import { loadConfig } from "../../src/shared/infra/config/app-config";
import { CorrelationService } from "../../src/shared/infra/correlation";
import { LoggerService } from "../../src/shared/infra/logger";
import { MetricsService } from "../../src/shared/infra/metrics";
import { Database } from "../../src/shared/infra/persistence/database";
import { SqlUnitOfWork } from "../../src/shared/infra/persistence/sql-unit-of-work";
import { UuidV7IdGenerator } from "../../src/shared/infra/uuid-v7-id-generator";
import { ReprocessPendingReference } from "../../src/wagering/infra/reprocess-pending-reference.worker";
import { type Clock } from "../../src/shared/domain/clock";
import { TEST_AWS_ENDPOINT, TEST_DATABASE_URL } from "./env";

/** Monta o worker de referência sobre o ORM do teste com um `Clock` controlável (ADR-004). */
export function referenceWorker(orm: MikroORM, clock: Clock): ReprocessPendingReference {
  const config = loadConfig({
    ...process.env,
    DATABASE_URL: TEST_DATABASE_URL,
    AWS_ENDPOINT_URL: TEST_AWS_ENDPOINT,
  });
  const uow = new SqlUnitOfWork(new Database(orm), config);
  const correlation = new CorrelationService();
  const logger = new LoggerService(config, correlation);
  return new ReprocessPendingReference(
    uow,
    new UuidV7IdGenerator(),
    clock,
    config,
    new MetricsService(),
    logger,
    correlation,
  );
}
