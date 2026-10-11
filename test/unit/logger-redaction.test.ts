import { describe, expect, test } from "bun:test";
import { pino } from "pino";
import { REDACT_PATHS } from "../../src/shared/infra/logger";

/** Verifica que os caminhos sensíveis são censurados antes de chegar ao stdout (spec §10). */
describe("log redaction", () => {
  test("money, balances and request bodies are censored", () => {
    const lines: string[] = [];
    const logger = pino(
      { redact: { paths: REDACT_PATHS, censor: "[redacted]" } },
      { write: (chunk: string) => lines.push(chunk) },
    );

    logger.info(
      {
        money: { amount: "10.00", currency: "BRL" },
        balance: "5.00",
        req: { body: { playerId: "secret" } },
        headers: { authorization: "Bearer token" },
        walletId: "wallet-1",
      },
      "processed",
    );

    const output = lines.join("");
    expect(output).toContain("[redacted]");
    expect(output).not.toContain("10.00");
    expect(output).not.toContain("5.00");
    expect(output).not.toContain("Bearer token");
    expect(output).not.toContain("secret");
    // Campos de contexto não-sensíveis permanecem.
    expect(output).toContain("wallet-1");
  });
});
