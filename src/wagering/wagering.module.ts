import { Module } from "@nestjs/common";
import { GetTransaction } from "./application/get-transaction";
import { SubmitWagerTransaction } from "./application/submit-wager-transaction";
import { WageringController } from "./infra/http/wagering.controller";
import { ReprocessPendingReference } from "./infra/reprocess-pending-reference.worker";
import { WagerConsumer } from "./infra/sqs/wager-consumer.worker";

/** Contexto `wagering` (spec §2.1): submissão (HTTP/SQS), consulta, worker de referência e consumer. */
@Module({
  controllers: [WageringController],
  providers: [SubmitWagerTransaction, GetTransaction, ReprocessPendingReference, WagerConsumer],
})
export class WageringModule {}
