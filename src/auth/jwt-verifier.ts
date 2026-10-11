import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";
import { type AppConfig } from "../shared/infra/config/app-config";

/** Claims que o guard usa: `azp` identifica o client (provedor) que obteve o token. */
export interface VerifiedToken {
  readonly subject: string | undefined;
  readonly authorizedParty: string | undefined;
}

/** Porta de verificação de JWT. A infra valida assinatura (JWKS), `iss`, `aud` e expiração. */
export interface JwtVerifier {
  verify(token: string): Promise<VerifiedToken>;
}

export const JWT_VERIFIER = Symbol("JWT_VERIFIER");

/**
 * Verifica JWT RS256 contra o JWKS do Identity Provider (Keycloak em dev, ADR-011). Valida
 * emissor, audiência (quando configurada) e expiração; lança se o token for inválido.
 */
export class JwksJwtVerifier implements JwtVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;
  private readonly audience: string | undefined;

  constructor(config: AppConfig) {
    if (config.auth.jwksUri === undefined || config.auth.issuer === undefined) {
      throw new Error("JwksJwtVerifier requires AUTH_JWKS_URI and AUTH_ISSUER");
    }
    this.jwks = createRemoteJWKSet(new URL(config.auth.jwksUri));
    this.issuer = config.auth.issuer;
    this.audience = config.auth.audience;
  }

  async verify(token: string): Promise<VerifiedToken> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.issuer,
      ...(this.audience === undefined ? {} : { audience: this.audience }),
    });
    return { subject: payload.sub, authorizedParty: readAuthorizedParty(payload) };
  }
}

function readAuthorizedParty(payload: JWTPayload): string | undefined {
  const azp = payload["azp"];
  return typeof azp === "string" ? azp : undefined;
}
