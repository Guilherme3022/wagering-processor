/** Identidade do provedor por trás de uma requisição (spec §12, ADR-011). */
export interface ProviderIdentity {
  readonly providerId: string;
}

/**
 * Porta que resolve a identidade do provedor. Hoje lê o `providerId` do payload; o desenho alvo
 * (documentado em ARCHITECTURE, ADR-011) valida um JWT via JWKS e compara o claim `azp` com o
 * `providerId`. A regra de domínio continua validando o `providerId` de qualquer forma.
 */
export interface ProviderIdentityPort {
  resolve(request: { body?: unknown; headers: Record<string, unknown> }): ProviderIdentity | null;
}

export const PROVIDER_IDENTITY = Symbol("PROVIDER_IDENTITY");
