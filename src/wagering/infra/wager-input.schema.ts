import { z } from "zod";
import { moneySchema } from "../../shared/infra/http/money.schema";

/** `providerId` da API: minúsculas, dígitos e hífen (spec §3.6). Exclui `__system__`. */
const PROVIDER_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

const wagerFieldsSchema = z.object({
  providerId: z.string().regex(PROVIDER_PATTERN),
  externalTransactionId: z.string().min(1).max(255),
  playerId: z.string().uuid(),
  walletId: z.string().uuid(),
  roundId: z.string().min(1),
  gameId: z.string().min(1),
  kind: z.enum(["BET", "WIN", "LOSS", "REFUND", "ROLLBACK"]),
  money: moneySchema,
  referenceExternalTransactionId: z.string().min(1).optional(),
});

function refineBetReference(
  value: { kind: string; money: { amount: string }; referenceExternalTransactionId?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.kind === "BET" && value.referenceExternalTransactionId !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["referenceExternalTransactionId"],
      message: "BET must not carry a reference",
    });
  }
  // Transação exige valor positivo (challenge §6.1); "0.00" é a única forma zero da escala válida.
  if (value.money.amount === "0.00") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["money", "amount"], message: "amount must be greater than zero" });
  }
}

/** Campos de negócio no corpo HTTP (`Idempotency-Key` vem no header). */
export const wagerBusinessSchema = wagerFieldsSchema.superRefine(refineBetReference);
export type WagerBusinessInput = z.infer<typeof wagerBusinessSchema>;

/** `data` da mensagem SQS: os mesmos campos + `idempotencyKey` (spec §8.2). */
export const wagerMessageDataSchema = wagerFieldsSchema
  .extend({ idempotencyKey: z.string().min(1).max(255) })
  .superRefine(refineBetReference);

/** Envelope `WagerTransactionRequested` (spec §8.2). */
export const requestedEnvelopeSchema = z.object({
  messageId: z.string().min(1),
  type: z.literal("WagerTransactionRequested"),
  occurredAt: z.string().optional(),
  correlationId: z.string().optional(),
  data: wagerMessageDataSchema,
});

export type RequestedEnvelope = z.infer<typeof requestedEnvelopeSchema>;
