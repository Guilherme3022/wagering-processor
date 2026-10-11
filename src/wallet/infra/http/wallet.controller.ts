import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CorrelationService } from "../../../shared/infra/correlation";
import { NotFoundError } from "../../../shared/infra/http/app-error";
import { moneySchema } from "../../../shared/infra/http/money.schema";
import { uuidParam } from "../../../shared/infra/http/route-params";
import { LoggerService } from "../../../shared/infra/logger";
import { MetricsService } from "../../../shared/infra/metrics";
import { GetWallet } from "../../application/get-wallet";
import { ListLedger } from "../../application/list-ledger";
import { OpenWallet } from "../../application/open-wallet";
import { ReconcileWallet } from "../../application/reconcile-wallet";
import { decodeCursor, encodeCursor } from "./ledger-cursor";

const createWalletSchema = z.object({
  playerId: z.string().uuid(),
  initialBalance: moneySchema,
});

const ledgerQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

@Controller()
export class WalletController {
  constructor(
    private readonly openWallet: OpenWallet,
    private readonly getWallet: GetWallet,
    private readonly listLedger: ListLedger,
    private readonly reconcileWallet: ReconcileWallet,
    private readonly correlation: CorrelationService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
  ) {}

  @Post("wallets")
  @HttpCode(201)
  async create(@Body() body: unknown): Promise<unknown> {
    const input = createWalletSchema.parse(body);
    return this.openWallet.execute({
      playerId: input.playerId,
      initialBalance: input.initialBalance,
      correlationId: this.correlation.correlationId() ?? "unknown",
    });
  }

  @Get("wallets/:walletId")
  async read(@Param("walletId") walletIdParam: string): Promise<unknown> {
    const walletId = uuidParam(walletIdParam, "walletId");
    const wallet = await this.getWallet.execute(walletId);
    if (wallet === null) {
      throw new NotFoundError(`wallet ${walletId} not found`);
    }
    return wallet;
  }

  @Get("wallets/:walletId/ledger")
  async ledger(
    @Param("walletId") walletIdParam: string,
    @Query() query: unknown,
  ): Promise<unknown> {
    const walletId = uuidParam(walletIdParam, "walletId");
    const { cursor, limit } = ledgerQuerySchema.parse(query);
    const afterSeq = cursor === undefined ? null : decodeCursor(cursor);
    const page = await this.listLedger.execute(walletId, afterSeq, limit);
    return {
      items: page.items,
      nextCursor: page.nextSeq === null ? null : encodeCursor(page.nextSeq),
    };
  }

  @Post("wallets/:walletId/reconciliation")
  @HttpCode(200)
  async reconcile(@Param("walletId") walletIdParam: string): Promise<unknown> {
    const walletId = uuidParam(walletIdParam, "walletId");
    const result = await this.reconcileWallet.execute(walletId);
    if (result === null) {
      throw new NotFoundError(`wallet ${walletId} not found`);
    }
    if (!result.consistent) {
      this.metrics.reconciliationMismatches.inc();
      this.logger.warn("wallet reconciliation mismatch", {
        walletId,
        chainValid: result.chainValid,
      });
    }
    return result;
  }
}
