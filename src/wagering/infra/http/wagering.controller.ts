import { Body, Controller, Get, Headers, Param, Post, Res } from "@nestjs/common";
import { type Response } from "express";
import { CorrelationService } from "../../../shared/infra/correlation";
import { LoggerService } from "../../../shared/infra/logger";
import {
  NotFoundError,
  ReferenceRequiredError,
  ValidationError,
} from "../../../shared/infra/http/app-error";
import { MetricsService } from "../../../shared/infra/metrics";
import { uuidParam } from "../../../shared/infra/http/route-params";
import { WagerStatus } from "../../domain/wager-status";
import { GetTransaction } from "../../application/get-transaction";
import { type SubmitResult, SubmitWagerTransaction } from "../../application/submit-wager-transaction";
import { wagerBusinessSchema } from "../wager-input.schema";

function httpStatusFor(result: SubmitResult): number {
  if (result.status === WagerStatus.Processed) {
    return result.idempotentReplay ? 200 : 201;
  }
  if (result.status === WagerStatus.PendingReference) {
    return 202;
  }
  return 422; // REJECTED (nova ou replay) — corpo de transação, não problem+json
}

@Controller()
export class WageringController {
  constructor(
    private readonly submit: SubmitWagerTransaction,
    private readonly getTransaction: GetTransaction,
    private readonly correlation: CorrelationService,
    private readonly metrics: MetricsService,
    private readonly logger: LoggerService,
  ) {}

  @Post("wagering/transactions")
  async submitTransaction(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{
    transactionId: string;
    status: string;
    balance: SubmitResult["balance"];
    failureCode: SubmitResult["failureCode"];
    idempotentReplay: boolean;
  }> {
    if (idempotencyKey === undefined || idempotencyKey.length < 1 || idempotencyKey.length > 255) {
      throw new ValidationError("Idempotency-Key header is required (1-255 chars)");
    }
    const input = wagerBusinessSchema.parse(body);
    if (
      (input.kind === "REFUND" || input.kind === "ROLLBACK") &&
      input.referenceExternalTransactionId === undefined
    ) {
      throw new ReferenceRequiredError();
    }
    this.correlation.set({ providerId: input.providerId, walletId: input.walletId });
    const startedAt = performance.now();
    const end = this.metrics.processingDuration.startTimer({ source: "http" });
    const result = await this.submit.execute({
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      playerId: input.playerId,
      walletId: input.walletId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: input.money,
      referenceExternalTransactionId: input.referenceExternalTransactionId ?? null,
      idempotencyKey,
      correlationId: this.correlation.correlationId() ?? "unknown",
      causationId: idempotencyKey,
      source: { type: "http" },
    });
    end({ status: result.status });
    this.correlation.set({ transactionId: result.transactionId });
    this.metrics.wagerTransactions.inc({ status: result.status, kind: input.kind, source: "http" });
    if (result.idempotentReplay) {
      this.metrics.idempotencyDuplicates.inc({ source: "http", outcome: "replay" });
    }
    // Log do resultado de cada transação (spec §12): sem valores monetários, só status/kind/falha.
    this.logger.info("wager transaction handled", {
      source: "http",
      status: result.status,
      kind: input.kind,
      failureCode: result.failureCode,
      idempotentReplay: result.idempotentReplay,
      durationMs: Math.round(performance.now() - startedAt),
    });
    res.status(httpStatusFor(result));
    // `inboxDuplicate` é sinal interno para o consumer SQS; não vaza no contrato HTTP.
    return {
      transactionId: result.transactionId,
      status: result.status,
      balance: result.balance,
      failureCode: result.failureCode,
      idempotentReplay: result.idempotentReplay,
    };
  }

  @Get("wagering/transactions/:transactionId")
  async byId(@Param("transactionId") transactionIdParam: string): Promise<unknown> {
    const transactionId = uuidParam(transactionIdParam, "transactionId");
    const tx = await this.getTransaction.byId(transactionId);
    if (tx === null) {
      throw new NotFoundError(`transaction ${transactionId} not found`);
    }
    return tx;
  }

  @Get("providers/:providerId/wagering/transactions/:externalTransactionId")
  async byProviderExternal(
    @Param("providerId") providerId: string,
    @Param("externalTransactionId") externalTransactionId: string,
  ): Promise<unknown> {
    const tx = await this.getTransaction.byProviderExternal(providerId, externalTransactionId);
    if (tx === null) {
      throw new NotFoundError(`transaction ${providerId}/${externalTransactionId} not found`);
    }
    return tx;
  }
}
