import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { type Request } from "express";
import { PROVIDER_IDENTITY, type ProviderIdentityPort } from "./provider-identity";

// Health e métricas nunca exigem auth (spec §10); ficam fora do guard por desenho.
const PUBLIC_PREFIXES = ["/health", "/metrics"];

/**
 * Guard **no-op** aplicado globalmente (ADR-011, vale 0 pontos na avaliação). Hoje sempre libera e
 * só anexa a identidade do provedor à requisição, servindo de ponto de extensão: o desenho alvo
 * (Keycloak client-credentials, JWT via JWKS, `azp` vs `providerId`) entra aqui sem mudar o resto.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(PROVIDER_IDENTITY) private readonly identity: ProviderIdentityPort) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { providerIdentity?: unknown }>();
    if (PUBLIC_PREFIXES.some((prefix) => request.path.startsWith(prefix))) {
      return true;
    }
    const identity = this.identity.resolve(request);
    if (identity !== null) {
      request.providerIdentity = identity;
    }
    return true;
  }
}
