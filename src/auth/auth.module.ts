import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { type AppConfig } from "../shared/infra/config/app-config";
import { APP_CONFIG } from "../shared/infra/config/config.module";
import { AuthGuard } from "./auth.guard";
import { JWT_VERIFIER, type JwtVerifier, JwksJwtVerifier } from "./jwt-verifier";
import { PayloadProviderIdentity } from "./payload-provider-identity";
import { PROVIDER_IDENTITY } from "./provider-identity";

/**
 * Autenticação (ADR-011): guard global que valida JWT via JWKS quando AUTH_ENABLED=true e é no-op
 * caso contrário. O verificador JWKS só é construído quando a auth está ligada.
 */
@Module({
  providers: [
    { provide: PROVIDER_IDENTITY, useClass: PayloadProviderIdentity },
    {
      provide: JWT_VERIFIER,
      useFactory: (config: AppConfig): JwtVerifier =>
        config.auth.enabled ? new JwksJwtVerifier(config) : { verify: () => Promise.reject(new Error("auth disabled")) },
      inject: [APP_CONFIG],
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
