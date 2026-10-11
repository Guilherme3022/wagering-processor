import { postJson } from "./app";

/** Qualquer cliente HTTP dos testes (app comum ou app com mensageria). */
export interface HttpClient {
  request(path: string, init?: RequestInit): Promise<Response>;
}

export interface BetBody {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: "BET" | "WIN" | "LOSS" | "REFUND" | "ROLLBACK";
  money: { amount: string; currency: string };
  referenceExternalTransactionId?: string;
}

/** Cria uma wallet e devolve `{ id, playerId }`. */
export async function openWallet(
  app: HttpClient,
  amount: string,
): Promise<{ id: string; playerId: string }> {
  const playerId = crypto.randomUUID();
  const response = await app.request(
    "/wallets",
    postJson({ playerId, initialBalance: { amount, currency: "BRL" } }),
  );
  const body = (await response.json()) as { id: string };
  return { id: body.id, playerId };
}

export function betBody(overrides: Partial<BetBody> & Pick<BetBody, "playerId" | "walletId">): BetBody {
  const external = overrides.externalTransactionId ?? crypto.randomUUID();
  return {
    providerId: "provider-a",
    externalTransactionId: external,
    roundId: "round-1",
    gameId: "game-1",
    kind: "BET",
    money: { amount: "25.00", currency: "BRL" },
    ...overrides,
  };
}

export function submit(app: HttpClient, body: BetBody, idempotencyKey?: string): Promise<Response> {
  const key = idempotencyKey ?? `${body.providerId}:${body.externalTransactionId}`;
  return app.request("/wagering/transactions", postJson(body, { "idempotency-key": key }));
}

export interface SubmitResponse {
  transactionId: string;
  status: string;
  balance: { amount: string; currency: string } | null;
  failureCode: string | null;
  idempotentReplay: boolean;
}
