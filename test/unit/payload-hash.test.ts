import { describe, expect, test } from "bun:test";
import {
  type HashablePayload,
  PayloadHasher,
} from "../../src/wagering/domain/payload-hasher";
import { WagerKind } from "../../src/wagering/domain/wager-kind";

const hasher = new PayloadHasher();

const vector: HashablePayload = {
  providerId: "provider-a",
  externalTransactionId: "transaction-123",
  playerId: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  walletId: "0192f291-27dd-7d3f-8071-5f8685deef37",
  roundId: "round-987",
  gameId: "fortune-chimp",
  kind: WagerKind.Bet,
  money: { amount: "25.00", currency: "BRL" },
  referenceExternalTransactionId: null,
};

// Vetor fixo da spec §3.5. Se mudar, o algoritmo de hash mudou e o contrato quebrou.
const EXPECTED = "v1:6ff120b653ab29c549944171b99b9bd2781fd142504011f05029c37c3d9c8974";

describe("PayloadHasher (ADR-008, spec §3.5)", () => {
  test("matches the fixed test vector", () => {
    expect(hasher.hash(vector)).toBe(EXPECTED);
  });

  test("key order in the input is irrelevant", () => {
    const reordered: HashablePayload = {
      money: { currency: "BRL", amount: "25.00" },
      referenceExternalTransactionId: null,
      gameId: "fortune-chimp",
      roundId: "round-987",
      kind: WagerKind.Bet,
      walletId: "0192f291-27dd-7d3f-8071-5f8685deef37",
      playerId: "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
      externalTransactionId: "transaction-123",
      providerId: "provider-a",
    };
    expect(hasher.hash(reordered)).toBe(EXPECTED);
  });

  test("a different amount yields a different hash (no rounding collisions)", () => {
    expect(hasher.hash({ ...vector, money: { amount: "25.01", currency: "BRL" } })).not.toBe(
      EXPECTED,
    );
  });

  test("a present reference changes the hash", () => {
    expect(hasher.hash({ ...vector, referenceExternalTransactionId: "ref-1" })).not.toBe(EXPECTED);
  });

  test("always carries the version prefix", () => {
    expect(hasher.hash(vector).startsWith("v1:")).toBe(true);
  });
});
