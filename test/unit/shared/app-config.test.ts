import { describe, expect, test } from "bun:test";
import { InvalidConfigError, loadConfig } from "../../../src/shared/infra/config/app-config";

const minimalEnv = { DATABASE_URL: "postgres://wagering:wagering@localhost:5432/wagering" };

describe("loadConfig", () => {
  test("applies the spec §11 defaults when only the database url is given", () => {
    const config = loadConfig(minimalEnv);

    expect(config.port).toBe(3000);
    expect(config.database.lockTimeoutMs).toBe(2000);
    expect(config.sqs.inputQueue).toBe("wager-transactions.fifo");
    expect(config.sqs.maxReceiveCount).toBe(5);
    expect(config.pendingReference.ttlMs).toBe(86_400_000);
    expect(config.instanceId).toContain(String(process.pid));
  });

  test("fails with a readable message when DATABASE_URL is missing", () => {
    expect(() => loadConfig({})).toThrow(InvalidConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  test("reports every invalid variable at once", () => {
    try {
      loadConfig({ ...minimalEnv, PORT: "abc", SQS_INPUT_QUEUE: "not-fifo" });
      throw new Error("expected loadConfig to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidConfigError);
      const issues = (error as InvalidConfigError).issues.join("\n");
      expect(issues).toContain("PORT");
      expect(issues).toContain("SQS_INPUT_QUEUE");
    }
  });

  test("rejects fault injection outside the test environment", () => {
    const env = { ...minimalEnv, FAULT_INJECTION: "exit_after_commit_before_ack" };

    expect(() => loadConfig({ ...env, NODE_ENV: "production" })).toThrow(/FAULT_INJECTION/);
    expect(loadConfig({ ...env, NODE_ENV: "test" }).faultInjection).toBe(
      "exit_after_commit_before_ack",
    );
  });
});
