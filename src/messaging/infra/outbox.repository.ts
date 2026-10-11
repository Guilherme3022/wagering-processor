import { Injectable } from "@nestjs/common";
import { Database } from "../../shared/infra/persistence/database";

export interface OutboxRecord {
  readonly id: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: string;
  readonly attempts: number;
}

interface ClaimRow {
  id: string;
  aggregate_id: string;
  event_type: string;
  payload: string;
  attempts: number;
}

interface StatsRow {
  pending: number;
  oldest: Date | string | null;
}

/**
 * Acesso à outbox para o publisher (claim com lease + `SKIP LOCKED`, marcação condicionada ao
 * `locked_by`, retry). Transações curtas e separadas das financeiras (spec §6.5).
 */
@Injectable()
export class OutboxRepository {
  constructor(private readonly database: Database) {}

  async claim(
    instanceId: string,
    now: Date,
    leaseUntil: Date,
    limit: number,
  ): Promise<OutboxRecord[]> {
    return this.database.transaction(async (session) => {
      const rows = await session.select<ClaimRow>(
        `UPDATE outbox_messages SET locked_until = ?, locked_by = ?
           WHERE id IN (
             SELECT id FROM outbox_messages
              WHERE published_at IS NULL AND next_attempt_at <= ?
                AND (locked_until IS NULL OR locked_until < ?)
              ORDER BY occurred_at LIMIT ? FOR UPDATE SKIP LOCKED)
         RETURNING id, aggregate_id, event_type, payload::text AS payload, attempts`,
        [leaseUntil, instanceId, now, now, limit],
      );
      return rows.map((row) => ({
        id: row.id,
        aggregateId: row.aggregate_id,
        eventType: row.event_type,
        payload: row.payload,
        attempts: row.attempts,
      }));
    });
  }

  async markPublished(id: string, instanceId: string, at: Date): Promise<void> {
    await this.database.transaction((session) =>
      session.command(
        `UPDATE outbox_messages SET published_at = ?, locked_until = NULL
          WHERE id = ? AND locked_by = ? AND published_at IS NULL`,
        [at, id, instanceId],
      ),
    );
  }

  async scheduleRetry(id: string, instanceId: string, nextAttemptAt: Date, error: string): Promise<void> {
    await this.database.transaction((session) =>
      session.command(
        `UPDATE outbox_messages
            SET attempts = attempts + 1, next_attempt_at = ?, last_error = ?, locked_until = NULL
          WHERE id = ? AND locked_by = ?`,
        [nextAttemptAt, error.slice(0, 500), id, instanceId],
      ),
    );
  }

  async releaseLeases(instanceId: string): Promise<void> {
    await this.database.transaction((session) =>
      session.command(
        `UPDATE outbox_messages SET locked_until = NULL
          WHERE locked_by = ? AND published_at IS NULL`,
        [instanceId],
      ),
    );
  }

  async stats(): Promise<{ pending: number; oldestOccurredAt: Date | null }> {
    return this.database.transaction(async (session) => {
      const rows = await session.select<StatsRow>(
        `SELECT count(*)::int AS pending, min(occurred_at) AS oldest
           FROM outbox_messages WHERE published_at IS NULL`,
      );
      const row = rows[0];
      const oldest = row?.oldest ?? null;
      return {
        pending: row?.pending ?? 0,
        oldestOccurredAt: oldest === null ? null : oldest instanceof Date ? oldest : new Date(oldest),
      };
    });
  }
}
