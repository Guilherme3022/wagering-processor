import { Module } from "@nestjs/common";
import { GetTransaction } from "./application/get-transaction";
import { SubmitWagerTransaction } from "./application/submit-wager-transaction";
import { WageringController } from "./infra/http/wagering.controller";

/** Contexto `wagering` (spec §2.1): submissão (HTTP/SQS) e consulta de transações. */
@Module({
  controllers: [WageringController],
  providers: [SubmitWagerTransaction, GetTransaction],
})
export class WageringModule {}
