import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDatabase, type TestDatabase } from "../support/database";
import { uniqueSuffix } from "../support/env";
import { eventually } from "../support/async";
import { drainQueue, publisherStack } from "../support/messaging";

let db: TestDatabase;
let eventsQueue: string;

beforeAll(async () => {
  db = await createTestDatabase();
  eventsQueue = `wagering-events-${uniqueSuffix()}.fifo`;
  const { sqs } = publisherStack(db.orm, { eventsQueue, instanceId: "setup", leaseMs: 1000 });
  await sqs.createFifoQueue(eventsQueue);
});

afterAll(async () => {
  await db.close();
});

/** Insere `count` eventos pendentes direto na outbox, com eventId = id. */
async function seedOutbox(count: number): Promise<string[]> {
  const ids: string[] = [];
  const connection = db.orm.em.getConnection();
  for (let i = 0; i < count; i += 1) {
    const id = crypto.randomUUID();
    ids.push(id);
    const payload = JSON.stringify({ eventId: id, eventType: "WalletBalanceChanged", seq: i });
    await connection.execute(
      `INSERT INTO outbox_messages (id, aggregate_id, event_type, payload, occurred_at, attempts, next_attempt_at)
       VALUES (?, ?, 'WalletBalanceChanged', ?::jsonb, now(), 0, now())`,
      [id, `wallet-${i % 3}`, payload],
    );
  }
  return ids;
}

describe("C6 — multiple publishers over the same outbox", () => {
  test("a dead instance holding a lease does not lose events; all are published", async () => {
    const ids = await seedOutbox(10);
    const leaseMs = 700;
    const dead = publisherStack(db.orm, { eventsQueue, instanceId: "inst-dead", leaseMs });
    const alive = publisherStack(db.orm, { eventsQueue, instanceId: "inst-alive", leaseMs });

    // A instância "morta" reivindica metade (segura o lease) e nunca publica nem marca.
    const now = new Date();
    const claimed = await dead.repository.claim("inst-dead", now, new Date(now.getTime() + leaseMs), 5);
    expect(claimed.length).toBe(5);

    // A instância viva drena o que pode; o lease da morta expira e ela assume o resto.
    await eventually(
      async () => {
        await alive.publisher.publishOnce();
        const pending = await alive.repository.stats();
        expect(pending.pending).toBe(0);
      },
      { timeoutMs: 8000, intervalMs: 100 },
    );

    const bodies = await drainQueue(alive.sqs, eventsQueue);
    const publishedIds = new Set(bodies.map((body) => (JSON.parse(body) as { eventId: string }).eventId));
    for (const id of ids) {
      expect(publishedIds.has(id)).toBe(true);
    }
    expect(bodies.length).toBeGreaterThanOrEqual(ids.length);
  });

  test("P1-3: a claimed batch larger than the SQS limit of 10 is published in full", async () => {
    const ids = await seedOutbox(25);
    const publisher = publisherStack(db.orm, { eventsQueue, instanceId: "inst-big", leaseMs: 5000 });
    // Um único publishOnce reivindica os 25 (OUTBOX_BATCH=50) e precisa fatiar em chamadas de 10.
    let published = 0;
    while (published < 25) {
      published += await publisher.publisher.publishOnce();
    }
    expect(await publisher.repository.stats().then((s) => s.pending)).toBe(0);
    const bodies = await drainQueue(publisher.sqs, eventsQueue);
    const publishedIds = new Set(bodies.map((body) => (JSON.parse(body) as { eventId: string }).eventId));
    for (const id of ids) {
      expect(publishedIds.has(id)).toBe(true);
    }
  });

  test("P2-8: two concurrent active publishers drain the outbox, every event published", async () => {
    const ids = await seedOutbox(30);
    const a = publisherStack(db.orm, { eventsQueue, instanceId: "inst-a", leaseMs: 3000 });
    const b = publisherStack(db.orm, { eventsQueue, instanceId: "inst-b", leaseMs: 3000 });
    await eventually(
      async () => {
        await Promise.all([a.publisher.publishOnce(), b.publisher.publishOnce()]);
        expect((await a.repository.stats()).pending).toBe(0);
      },
      { timeoutMs: 10000, intervalMs: 50 },
    );
    const bodies = await drainQueue(a.sqs, eventsQueue);
    const publishedIds = new Set(bodies.map((body) => (JSON.parse(body) as { eventId: string }).eventId));
    for (const id of ids) {
      expect(publishedIds.has(id)).toBe(true);
    }
  });
});
