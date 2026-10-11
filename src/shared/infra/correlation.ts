import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable } from "@nestjs/common";

/** Campos de contexto carregados em todo log e resposta de erro (spec §10). */
export interface CorrelationFields {
  correlationId: string;
  messageId?: string;
  transactionId?: string;
  walletId?: string;
  providerId?: string;
  instanceId?: string;
}

/**
 * Propaga o contexto de correlação por `AsyncLocalStorage`, sem passar parâmetro por toda a
 * pilha. O HTTP semeia com o `X-Correlation-Id`; o consumer SQS, com o `messageId`.
 */
@Injectable()
export class CorrelationService {
  private readonly storage = new AsyncLocalStorage<CorrelationFields>();

  run<T>(seed: CorrelationFields, fn: () => T): T {
    return this.storage.run({ ...seed }, fn);
  }

  set(fields: Partial<CorrelationFields>): void {
    const current = this.storage.getStore();
    if (current !== undefined) {
      Object.assign(current, fields);
    }
  }

  get(): CorrelationFields | undefined {
    return this.storage.getStore();
  }

  correlationId(): string | undefined {
    return this.storage.getStore()?.correlationId;
  }
}
