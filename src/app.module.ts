import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { HealthModule } from "./health/health.module";
import { MessagingModule } from "./messaging/messaging.module";
import { ConfigModule } from "./shared/infra/config/config.module";
import { PersistenceModule } from "./shared/infra/persistence/persistence.module";
import { SharedInfraModule } from "./shared/infra/shared-infra.module";
import { WageringModule } from "./wagering/wagering.module";
import { WalletModule } from "./wallet/wallet.module";

@Module({
  imports: [
    ConfigModule,
    SharedInfraModule,
    PersistenceModule,
    AuthModule,
    HealthModule,
    WalletModule,
    WageringModule,
    MessagingModule,
  ],
})
export class AppModule {}
