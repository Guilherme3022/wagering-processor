import { z } from "zod";

/**
 * Forma de dinheiro na borda (HTTP/SQS). A escala estrita (ADR-003) é validada já aqui, para que
 * `"1"`, `"25.5"` ou moeda inválida virem `400`/DLQ no parse — não `InvalidMoneyError` lá dentro.
 * Zero (`"0.00"`) é aceito aqui (saldo inicial de wallet pode ser zero); transações exigem `> 0`
 * via `wagerBusinessSchema`.
 */
export const moneySchema = z.object({
  amount: z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/, "amount must have exactly two decimals"),
  currency: z.string().regex(/^[A-Z]{3}$/, "currency must be three uppercase letters"),
});

export type MoneyInput = z.infer<typeof moneySchema>;
