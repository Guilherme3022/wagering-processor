import { Module } from "@nestjs/common";
import { MessagingModule } from "./messaging/messaging.module";
import { WageringModule } from "./wagering/wagering.module";
import { WalletModule } from "./wallet/wallet.module";

@Module({
  imports: [WalletModule, WageringModule, MessagingModule],
})
export class AppModule {}
