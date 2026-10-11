import { Injectable } from "@nestjs/common";
import { type ProviderIdentity, type ProviderIdentityPort } from "./provider-identity";

/** Implementação atual: confia no canal e extrai `providerId` do corpo (ADR-011). */
@Injectable()
export class PayloadProviderIdentity implements ProviderIdentityPort {
  resolve(request: { body?: unknown }): ProviderIdentity | null {
    const body = request.body;
    if (typeof body === "object" && body !== null && "providerId" in body) {
      const providerId = (body as { providerId?: unknown }).providerId;
      if (typeof providerId === "string" && providerId.length > 0) {
        return { providerId };
      }
    }
    return null;
  }
}
