import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { exportJWK, generateKeyPair, type KeyLike, SignJWT } from "jose";
import { postJson, startTestApp, type TestApp } from "../support/app";

const ISSUER = "https://issuer.test";
let app: TestApp;
let jwks: ReturnType<typeof Bun.serve>;
let privateKey: KeyLike;

async function sign(azp: string): Promise<string> {
  return new SignJWT({ azp })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(ISSUER)
    .setSubject("service-account")
    .setExpirationTime("5m")
    .sign(privateKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  jwks = Bun.serve({
    port: 0,
    fetch: () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } }),
  });

  process.env.AUTH_ENABLED = "true";
  process.env.AUTH_JWKS_URI = `http://127.0.0.1:${jwks.port}/certs`;
  process.env.AUTH_ISSUER = ISSUER;
  app = await startTestApp();
});

afterAll(async () => {
  await app.close();
  await jwks.stop(true);
  delete process.env.AUTH_ENABLED;
  delete process.env.AUTH_JWKS_URI;
  delete process.env.AUTH_ISSUER;
});

const auth = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

describe("auth guard with AUTH_ENABLED=true (ADR-011)", () => {
  test("health stays open without a token", async () => {
    expect((await app.request("/health/live")).status).toBe(200);
  });

  test("a request without a bearer token is 401", async () => {
    const response = await app.request("/wallets", postJson({ playerId: crypto.randomUUID(), initialBalance: { amount: "10.00", currency: "BRL" } }));
    expect(response.status).toBe(401);
    expect((await response.json()) as { code: string }).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  test("a valid token authorizes a wallet and a matching-provider bet", async () => {
    const token = await sign("provider-a");
    const created = await app.request(
      "/wallets",
      postJson({ playerId: crypto.randomUUID(), initialBalance: { amount: "100.00", currency: "BRL" } }, auth(token)),
    );
    expect(created.status).toBe(201);
    const wallet = (await created.json()) as { id: string; playerId: string };

    const external = crypto.randomUUID();
    const bet = await app.request(
      "/wagering/transactions",
      postJson(
        { providerId: "provider-a", externalTransactionId: external, playerId: wallet.playerId, walletId: wallet.id, roundId: "r", gameId: "g", kind: "BET", money: { amount: "25.00", currency: "BRL" } },
        { ...auth(token), "idempotency-key": `provider-a:${external}` },
      ),
    );
    expect(bet.status).toBe(201);
  });

  test("a token whose azp differs from the providerId is 403", async () => {
    const token = await sign("provider-b"); // client provider-b
    const external = crypto.randomUUID();
    const response = await app.request(
      "/wagering/transactions",
      postJson(
        { providerId: "provider-a", externalTransactionId: external, playerId: crypto.randomUUID(), walletId: crypto.randomUUID(), roundId: "r", gameId: "g", kind: "BET", money: { amount: "25.00", currency: "BRL" } },
        { ...auth(token), "idempotency-key": `provider-a:${external}` },
      ),
    );
    expect(response.status).toBe(403);
    expect((await response.json()) as { code: string }).toMatchObject({ code: "FORBIDDEN" });
  });

  test("a garbage token is 401", async () => {
    const response = await app.request("/wallets", postJson({ playerId: crypto.randomUUID(), initialBalance: { amount: "1.00", currency: "BRL" } }, auth("not-a-jwt")));
    expect(response.status).toBe(401);
  });
});
