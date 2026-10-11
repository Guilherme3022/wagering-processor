import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startTestApp, type TestApp } from "../support/app";
import { betBody, openWallet, submit } from "../support/wager";

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.close();
});

describe("M9 — /metrics exposes the spec §10 metrics", () => {
  test("after a bet the expected counters and process metrics are present", async () => {
    const wallet = await openWallet(app, "100.00");
    await submit(app, betBody({ playerId: wallet.playerId, walletId: wallet.id, money: { amount: "10.00", currency: "BRL" } }));

    const body = await (await app.request("/metrics")).text();
    for (const metric of [
      "wager_transactions_total",
      "idempotency_duplicates_total",
      "wager_processing_duration_seconds",
      "lock_conflicts_total",
      "outbox_pending_messages",
      "pending_reference_transactions",
      "reconciliation_mismatches_total",
      "process_cpu_user_seconds_total",
    ]) {
      expect(body).toContain(metric);
    }
    expect(body).toContain('wager_transactions_total{status="PROCESSED",kind="BET",source="http"}');
  });
});
