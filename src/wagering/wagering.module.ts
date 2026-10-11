import { Module } from "@nestjs/common";
import { GetTransaction } from "./application/get-transaction";
import { SubmitWagerTransaction } from "./application/submit-wager-transaction";
import { WageringController } from "./infra/http/wagering.controller";
import { ReprocessPendingReference } from "./infra/reprocess-pending-reference.worker";

/** Contexto `wagering` (spec §2.1): submissão (HTTP/SQS), consulta e worker de referência. */
@Module({
  controllers: [WageringController],
  providers: [SubmitWagerTransaction, GetTransaction, ReprocessPendingReference],
})
export class WageringModule {}
