import { createHash } from "node:crypto";
import { type MoneyProps } from "../../shared/domain/money";
import { type WagerKind } from "./wager-kind";

/**
 * Subconjunto de negócio que entra no hash de idempotência (spec §3.5). Campos de transporte
 * (`Idempotency-Key`, `messageId`, `occurredAt`, `type`) ficam de fora de propósito: a mesma
 * operação enviada por HTTP ou por SQS produz o mesmo hash.
 */
export interface HashablePayload {
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly playerId: string;
  readonly walletId: string;
  readonly roundId: string | null;
  readonly gameId: string | null;
  readonly kind: WagerKind;
  readonly money: MoneyProps;
  readonly referenceExternalTransactionId: string | null;
}

const VERSION_PREFIX = "v1:";

type Canonical = string | null | { readonly [key: string]: Canonical };

/**
 * Hash estável de uma operação (ADR-008): JSON canônico (chaves ordenadas em todos os níveis,
 * sem espaços, strings como recebidas) → SHA-256 → hex minúsculo → prefixo `v1:`. Dois payloads
 * com os mesmos campos de negócio têm o mesmo hash, independentemente da ordem das chaves.
 */
export class PayloadHasher {
  hash(payload: HashablePayload): string {
    const canonical = this.canonicalize({
      providerId: payload.providerId,
      externalTransactionId: payload.externalTransactionId,
      playerId: payload.playerId,
      walletId: payload.walletId,
      roundId: payload.roundId,
      gameId: payload.gameId,
      kind: payload.kind,
      money: { amount: payload.money.amount, currency: payload.money.currency },
      referenceExternalTransactionId: payload.referenceExternalTransactionId,
    });
    const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
    return `${VERSION_PREFIX}${digest}`;
  }

  private canonicalize(value: Canonical): string {
    if (value === null) {
      return "null";
    }
    if (typeof value === "string") {
      return JSON.stringify(value);
    }
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${this.canonicalize(value[key] ?? null)}`);
    return `{${entries.join(",")}}`;
  }
}
