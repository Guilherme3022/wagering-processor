import { Global, Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { PENDING_REFERENCE_TTL_MS } from "../application/settings";
import { CLOCK } from "../domain/clock";
import { ID_GENERATOR } from "../domain/id-generator";
import { type AppConfig } from "./config/app-config";
import { APP_CONFIG } from "./config/config.module";
import { PayloadHasher } from "../../wagering/domain/payload-hasher";
import { CorrelationService } from "./correlation";
import { SystemClock } from "./system-clock";
import { UuidV7IdGenerator } from "./uuid-v7-id-generator";
import { AllExceptionsFilter } from "./http/all-exceptions.filter";
import { CorrelationMiddleware } from "./http/correlation.middleware";
import { MetricsController } from "./http/metrics.controller";
import { LoggerService } from "./logger";
import { MetricsService } from "./metrics";

/** Infra transversal: correlação, log, métricas e o filtro global de erros (spec §10, §7). */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    CorrelationService,
    LoggerService,
    MetricsService,
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: UuidV7IdGenerator },
    PayloadHasher,
    {
      provide: PENDING_REFERENCE_TTL_MS,
      useFactory: (config: AppConfig): number => config.pendingReference.ttlMs,
      inject: [APP_CONFIG],
    },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
  exports: [
    CorrelationService,
    LoggerService,
    MetricsService,
    CLOCK,
    ID_GENERATOR,
    PayloadHasher,
    PENDING_REFERENCE_TTL_MS,
  ],
})
export class SharedInfraModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes("*");
  }
}
