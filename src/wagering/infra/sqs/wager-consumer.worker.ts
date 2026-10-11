import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { BusinessRuleError } from "../../../shared/domain/domain-error";
import { FailureCode } from "../../../shared/domain/failure-code";
import { type AppConfig } from "../../../shared/infra/config/app-config";
import { InjectConfig } from "../../../shared/infra/config/config.module";
import { CorrelationService } from "../../../shared/infra/correlation";
import { delay, withDeadline } from "../../../shared/infra/delay";
import {
  describeError,
  isTransientError,
  PG_LOCK_NOT_AVAILABLE,
  pgErrorCode,
} from "../../../shared/infra/http/db-error";
import { LoggerService } from "../../../shared/infra/logger";
import { MetricsService } from "../../../shared/infra/metrics";
import { InboxPayloadConflictError } from "../../../messaging/domain/inbox-errors";
import { type ReceivedMessage, SqsClient } from "../../../messaging/infra/sqs/sqs-client";
import { SubmitWagerTransaction } from "../../application/submit-wager-transaction";
import { requestedEnvelopeSchema } from "../wager-input.schema";

export const CONSUMER_NAME = "wager-transactions-consumer";
const MAX_BACKOFF_SECONDS = 300;

/**
 * Consome a fila de entrada (ADR-010). Valida o envelope, chama o **mesmo** `SubmitWagerTransaction`
 * do HTTP e classifica o resultado: negócio → ack; transitório (PG ou transporte SQS) → retry por
 * visibilidade; permanente → DLQ. O `ack` acontece **depois** do commit e numa etapa separada: se o
 * `DeleteMessage` falhar, a mensagem só é reentregue e a inbox dedup — nunca vira DLQ. Toda operação
 * de transporte é protegida para que uma falha de rede não derrube o loop. `SIGTERM` para o polling
 * e espera os em voo até o grace (o próprio race limita a espera total).
 */
@Injectable()
export class WagerConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private running = false;
  private loopPromise: Promise<void> | undefined;
  private readonly abort = new AbortController();
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly submit: SubmitWagerTransaction,
    private readonly sqs: SqsClient,
    @InjectConfig() private readonly config: AppConfig,
    private readonly metrics: MetricsService,
    private readonly logger: LoggerService,
    private readonly correlation: CorrelationService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.workersEnabled) {
      return;
    }
    this.running = true;
    this.loopPromise = this.runLoop();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    this.abort.abort();
    // O grace limita a espera TOTAL (loop + in-flight); uma operação travada não prende o shutdown.
    await withDeadline(this.drain(), this.config.shutdownGraceMs);
  }

  private async drain(): Promise<void> {
    if (this.loopPromise !== undefined) {
      await this.loopPromise;
    }
    await Promise.allSettled([...this.inFlight]);
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      let messages: ReceivedMessage[];
      try {
        messages = await this.sqs.receive(this.config.sqs.inputQueue, {
          maxMessages: 10,
          waitSeconds: 20,
          visibilityTimeout: this.config.sqs.visibilityTimeoutSeconds,
          abortSignal: this.abort.signal,
        });
      } catch {
        if (!this.running) {
          return;
        }
        await delay(500); // erro transitório no receive: espera curta e tenta de novo
        continue;
      }
      await Promise.allSettled(messages.map((message) => this.track(message)));
    }
  }

  private track(message: ReceivedMessage): Promise<void> {
    const promise = this.handle(message).finally(() => this.inFlight.delete(promise));
    this.inFlight.add(promise);
    return promise;
  }

  /** Processa uma mensagem. Nunca lança: qualquer falha é tratada e registrada aqui dentro. */
  async handle(message: ReceivedMessage): Promise<void> {
    let envelope: ReturnType<typeof requestedEnvelopeSchema.parse>;
    try {
      envelope = requestedEnvelopeSchema.parse(JSON.parse(message.body));
    } catch {
      // JSON inválido, schema inválido, type desconhecido ou kind=OPENING → permanente.
      await this.toDlq(message, "invalid_envelope");
      return;
    }
    // A inbox usa o messageId do envelope (controlado pelo produtor), não o id interno do SQS.
    const messageId = envelope.messageId;
    await this.correlation.run(
      {
        correlationId: envelope.correlationId ?? messageId,
        messageId,
        providerId: envelope.data.providerId,
        walletId: envelope.data.walletId,
        instanceId: this.config.instanceId,
      },
      async () => {
        const startedAt = performance.now();
        const stopTimer = this.metrics.processingDuration.startTimer({ source: "sqs" });
        try {
          if (this.config.faultInjection === "fail_transient" && this.config.nodeEnv === "test") {
            const injected = new Error("injected transient failure");
            injected.name = "ThrottlingException";
            throw injected;
          }
          const result = await this.submit.execute({
            providerId: envelope.data.providerId,
            externalTransactionId: envelope.data.externalTransactionId,
            playerId: envelope.data.playerId,
            walletId: envelope.data.walletId,
            roundId: envelope.data.roundId,
            gameId: envelope.data.gameId,
            kind: envelope.data.kind,
            money: envelope.data.money,
            referenceExternalTransactionId: envelope.data.referenceExternalTransactionId ?? null,
            idempotencyKey: envelope.data.idempotencyKey,
            correlationId: envelope.correlationId ?? messageId,
            causationId: messageId,
            source: { type: "sqs", messageId, consumerName: CONSUMER_NAME },
          });
          // Commit concluído com sucesso. A partir daqui, nada deve virar DLQ.
          this.correlation.set({ transactionId: result.transactionId });
          stopTimer({ status: result.status });
          this.maybeInjectFaultBeforeAck();
          if (result.conflict) {
            // Conflito de idempotência/duplicidade: a inbox já foi gravada no commit → só confirma.
            this.metrics.idempotencyDuplicates.inc({ source: "sqs_idempotency", outcome: "conflict" });
          } else {
            this.recordSuccess(envelope.data.kind, result.status, result.idempotentReplay, result.inboxDuplicate);
          }
          // Log do resultado de cada mensagem (spec §12): sem valores monetários.
          this.logger.info("wager transaction handled", {
            source: "sqs",
            status: result.status,
            kind: envelope.data.kind,
            failureCode: result.failureCode,
            idempotentReplay: result.idempotentReplay,
            inboxDuplicate: result.inboxDuplicate,
            conflict: result.conflict,
            durationMs: Math.round(performance.now() - startedAt),
          });
          await this.safeAck(message);
        } catch (error) {
          stopTimer({ status: "error" });
          await this.classifyAndHandle(message, error);
        }
      },
    );
  }

  private async classifyAndHandle(message: ReceivedMessage, error: unknown): Promise<void> {
    if (error instanceof BusinessRuleError) {
      // Payload inválido é permanente → DLQ (não pode ser confirmado silenciosamente).
      if (
        error.failureCode === FailureCode.InvalidPayload ||
        error.failureCode === FailureCode.ReferenceRequired
      ) {
        await this.toDlq(message, "invalid_payload");
        return;
      }
      // Conflito de idempotência / duplicidade: resultado terminal de negócio → ack.
      this.metrics.idempotencyDuplicates.inc({ source: "sqs_idempotency", outcome: "conflict" });
      await this.safeAck(message);
      return;
    }
    if (error instanceof InboxPayloadConflictError) {
      await this.toDlq(message, "inbox_conflict");
      return;
    }
    // Conflitos de idempotência/duplicidade (inclusive em corrida) são resolvidos no use case, que
    // grava a inbox antes do ack. Qualquer `23505` que chegue aqui é inesperado (ex.: outbox) → DLQ.
    if (isTransientError(error)) {
      if (pgErrorCode(error) === PG_LOCK_NOT_AVAILABLE) {
        this.metrics.lockConflicts.inc();
      }
      this.metrics.processingRetries.inc({ reason: "transient" });
      // Esgotou as tentativas: move à DLQ explicitamente (não dependemos do redrive do broker).
      if (message.approximateReceiveCount >= this.config.sqs.maxReceiveCount) {
        await this.toDlq(message, "transient_exhausted");
        return;
      }
      const backoff = Math.min(2 ** message.approximateReceiveCount, MAX_BACKOFF_SECONDS);
      await this.safeChangeVisibility(message, backoff);
      return;
    }
    this.logger.error("consumer permanent error", { error: describeError(error) });
    await this.toDlq(message, "processing_error");
  }

  /** Confirma a mensagem. Falha de `DeleteMessage` após commit é segura: redelivery + inbox dedup. */
  private async safeAck(message: ReceivedMessage): Promise<void> {
    try {
      await this.sqs.deleteMessage(this.config.sqs.inputQueue, message.receiptHandle);
    } catch (error) {
      this.logger.warn("ack (delete) failed; message will redeliver and be deduped by the inbox", {
        error: describeError(error),
      });
    }
  }

  private async safeChangeVisibility(message: ReceivedMessage, seconds: number): Promise<void> {
    try {
      await this.sqs.changeMessageVisibility(this.config.sqs.inputQueue, message.receiptHandle, seconds);
    } catch (error) {
      // Falha ao reprogramar a visibilidade: a mensagem reaparece após o timeout original.
      this.logger.warn("changeMessageVisibility failed; relying on the visibility timeout", {
        error: describeError(error),
      });
    }
  }

  private async toDlq(message: ReceivedMessage, reason: string): Promise<void> {
    try {
      await this.sqs.sendOne(this.config.sqs.deadLetterQueue, {
        id: message.messageId,
        body: message.body,
        groupId: message.messageId,
        deduplicationId: message.messageId,
      });
      await this.sqs.deleteMessage(this.config.sqs.inputQueue, message.receiptHandle);
      this.metrics.dlqMessages.inc({ reason });
    } catch (error) {
      // Transporte falhou ao mover para a DLQ: não deleta; o redrive do broker assume depois.
      this.logger.error("failed to move message to DLQ; leaving it for redrive", {
        reason,
        error: describeError(error),
      });
    }
  }

  private recordSuccess(kind: string, status: string, replay: boolean, inboxDuplicate: boolean): void {
    this.metrics.wagerTransactions.inc({ status, kind, source: "sqs" });
    if (inboxDuplicate) {
      this.metrics.idempotencyDuplicates.inc({ source: "sqs_inbox", outcome: "replay" });
    } else if (replay) {
      this.metrics.idempotencyDuplicates.inc({ source: "sqs_idempotency", outcome: "replay" });
    }
  }

  private maybeInjectFaultBeforeAck(): void {
    if (this.config.faultInjection === "exit_after_commit_before_ack" && this.config.nodeEnv === "test") {
      process.exit(137);
    }
  }
}
