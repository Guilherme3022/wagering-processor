/** Correlação de uma mensagem (spec §8.3). `causationId` é a mensagem/transação que a causou. */
export interface EventContext {
  readonly correlationId: string;
  readonly causationId?: string;
}

/** Envelope serializado que vai para a outbox e para o SQS. Só tipos JSON (sem `bigint`). */
export interface IntegrationEventEnvelope<TData> {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: string;
  readonly version: number;
  readonly data: TData;
}

export interface IntegrationEventParams<TData> {
  readonly eventId: string;
  readonly aggregateId: string;
  readonly occurredAt: Date;
  readonly data: TData;
  readonly context: EventContext;
}

/**
 * Evento de integração (spec §8.3). Uma subclasse por evento fixa `eventType` e `version` no
 * tipo e expõe uma factory `from(...)`. `data` carrega apenas tipos JSON (`MoneyProps` como
 * strings), porque `JSON.stringify` quebra com `bigint` e o payload precisa trafegar no SQS.
 */
export abstract class IntegrationEvent<TData> {
  abstract readonly eventType: string;
  abstract readonly version: number;

  protected constructor(private readonly params: IntegrationEventParams<TData>) {}

  get eventId(): string {
    return this.params.eventId;
  }

  get aggregateId(): string {
    return this.params.aggregateId;
  }

  get data(): TData {
    return this.params.data;
  }

  toJSON(): IntegrationEventEnvelope<TData> {
    const { eventId, aggregateId, occurredAt, data, context } = this.params;
    const envelope: IntegrationEventEnvelope<TData> = {
      eventId,
      eventType: this.eventType,
      aggregateId,
      correlationId: context.correlationId,
      occurredAt: occurredAt.toISOString(),
      version: this.version,
      data,
    };
    return context.causationId === undefined
      ? envelope
      : { ...envelope, causationId: context.causationId };
  }
}
