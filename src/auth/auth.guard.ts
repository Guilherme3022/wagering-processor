import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { type Request } from "express";
import { type AppConfig } from "../shared/infra/config/app-config";
import { InjectConfig } from "../shared/infra/config/config.module";
import { ForbiddenError, UnauthenticatedError } from "../shared/infra/http/app-error";
import { JWT_VERIFIER, type JwtVerifier } from "./jwt-verifier";
import { PROVIDER_IDENTITY, type ProviderIdentityPort } from "./provider-identity";

// Health e métricas nunca exigem auth (spec §10); ficam fora do guard por desenho.
const PUBLIC_PREFIXES = ["/health", "/metrics"];

/**
 * Guard global de autenticação (ADR-011). Com `AUTH_ENABLED=false` (padrão) é no-op e só anexa a
 * identidade do payload. Com `AUTH_ENABLED=true` exige um Bearer JWT válido (via JWKS do IdP);
 * quando o payload traz `providerId`, o claim `azp` do token tem de bater com ele, senão 403.
 * Mensagens da fila são canal interno confiável, mas o `providerId` segue sob validação de domínio.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @InjectConfig() private readonly config: AppConfig,
    @Inject(PROVIDER_IDENTITY) private readonly identity: ProviderIdentityPort,
    @Inject(JWT_VERIFIER) private readonly verifier: JwtVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { providerIdentity?: unknown }>();
    if (PUBLIC_PREFIXES.some((prefix) => request.path.startsWith(prefix))) {
      return true;
    }

    const claimed = this.identity.resolve(request);
    if (claimed !== null) {
      request.providerIdentity = claimed;
    }

    if (!this.config.auth.enabled) {
      return true; // no-op: ponto de extensão (ADR-011)
    }

    const token = bearerToken(request.headers.authorization);
    if (token === undefined) {
      throw new UnauthenticatedError("missing bearer token");
    }
    let verified;
    try {
      verified = await this.verifier.verify(token);
    } catch {
      throw new UnauthenticatedError("invalid token");
    }
    // Operações com providerId (apostas) exigem que o token pertença ao mesmo provedor.
    if (claimed !== null && verified.authorizedParty !== claimed.providerId) {
      throw new ForbiddenError("token does not belong to the requested provider");
    }
    return true;
  }
}

function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const match = /^Bearer (.+)$/.exec(header);
  return match?.[1];
}
