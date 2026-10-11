import { Injectable } from "@nestjs/common";
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";

/** Métricas da spec §10. Uma instância por processo; exposta em `GET /metrics`. */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly wagerTransactions: Counter<"status" | "kind" | "source">;
  readonly idempotencyDuplicates: Counter<"source" | "outcome">;
  readonly processingRetries: Counter<"reason">;
  readonly dlqMessages: Counter<"reason">;
  readonly lockConflicts: Counter<string>;
  readonly outboxLagSeconds: Gauge<string>;
  readonly outboxPending: Gauge<string>;
  readonly outboxPublishFailures: Counter<string>;
  readonly pendingReference: Gauge<string>;
  readonly processingDuration: Histogram<"source" | "status">;
  readonly reconciliationMismatches: Counter<string>;

  constructor() {
    collectDefaultMetrics({ register: this.registry });
    const registers = [this.registry];
    this.wagerTransactions = new Counter({
      name: "wager_transactions_total",
      help: "Transações de aposta por status, kind e origem",
      labelNames: ["status", "kind", "source"],
      registers,
    });
    this.idempotencyDuplicates = new Counter({
      name: "idempotency_duplicates_total",
      help: "Duplicatas detectadas por idempotência",
      labelNames: ["source", "outcome"],
      registers,
    });
    this.processingRetries = new Counter({
      name: "processing_retries_total",
      help: "Retentativas de processamento por razão",
      labelNames: ["reason"],
      registers,
    });
    this.dlqMessages = new Counter({
      name: "dlq_messages_total",
      help: "Mensagens enviadas para a DLQ por razão",
      labelNames: ["reason"],
      registers,
    });
    this.lockConflicts = new Counter({
      name: "lock_conflicts_total",
      help: "Conflitos de lock (lock_timeout) na wallet",
      registers,
    });
    this.outboxLagSeconds = new Gauge({
      name: "outbox_lag_seconds",
      help: "Idade do evento não publicado mais antigo",
      registers,
    });
    this.outboxPending = new Gauge({
      name: "outbox_pending_messages",
      help: "Eventos pendentes de publicação",
      registers,
    });
    this.outboxPublishFailures = new Counter({
      name: "outbox_publish_failures_total",
      help: "Falhas ao publicar eventos no SQS",
      registers,
    });
    this.pendingReference = new Gauge({
      name: "pending_reference_transactions",
      help: "Transações aguardando referência",
      registers,
    });
    this.processingDuration = new Histogram({
      name: "wager_processing_duration_seconds",
      help: "Duração do processamento de uma transação",
      labelNames: ["source", "status"],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers,
    });
    this.reconciliationMismatches = new Counter({
      name: "reconciliation_mismatches_total",
      help: "Divergências encontradas na reconciliação",
      registers,
    });
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}
