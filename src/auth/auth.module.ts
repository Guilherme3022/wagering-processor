import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "./auth.guard";
import { PayloadProviderIdentity } from "./payload-provider-identity";
import { PROVIDER_IDENTITY } from "./provider-identity";

/** Autenticação como ponto de extensão (ADR-011): guard no-op global + porta de identidade. */
@Module({
  providers: [
    { provide: PROVIDER_IDENTITY, useClass: PayloadProviderIdentity },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
