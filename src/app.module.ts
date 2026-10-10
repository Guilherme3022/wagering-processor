import { Module } from "@nestjs/common";
import { MessagingModule } from "./messaging/messaging.module";
import { ConfigModule } from "./shared/infra/config/config.module";
import { WageringModule } from "./wagering/wagering.module";
import { WalletModule } from "./wallet/wallet.module";

@Module({
  imports: [ConfigModule, WalletModule, WageringModule, MessagingModule],
})
export class AppModule {}
