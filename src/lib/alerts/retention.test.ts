import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  UNCONFIRMED_RETENTION_MS,
  purgeUnconfirmedRecords,
  shouldPurgeUnconfirmed,
  unconfirmedPurgeStatements,
  type PurgeSubscriber,
} from "./retention";

const now = Date.parse("2026-10-25T12:00:00.000Z");
const fresh = new Date(now - 2 * 86_400_000).toISOString();
const stale = new Date(now - 8 * 86_400_000).toISOString();
const edge = new Date(now - UNCONFIRMED_RETENTION_MS).toISOString();

function row(overrides: Partial<PurgeSubscriber> = {}): PurgeSubscriber {
  return {
    id: "ada@example.com::rtx-4060-ti-16gb",
    confirmed: false,
    createdAt: stale,
    ...overrides,
  };
}

describe("unconfirmed retention", () => {
  it("drops unconfirmed rows at 7 days and keeps a recent confirmation request", () => {
    expect(shouldPurgeUnconfirmed(row({ createdAt: fresh }), now)).toBe(false);
    expect(shouldPurgeUnconfirmed(row({ createdAt: stale }), now)).toBe(true);
    expect(shouldPurgeUnconfirmed(row({ createdAt: edge }), now)).toBe(true);
    expect(shouldPurgeUnconfirmed(row({ createdAt: stale, confirmed: true }), now)).toBe(false);
    expect(shouldPurgeUnconfirmed(row({ createdAt: stale, confirmSentAt: fresh }), now)).toBe(false);
    expect(shouldPurgeUnconfirmed(row({ createdAt: "not-a-date" }), now)).toBe(true);
    expect(shouldPurgeUnconfirmed(row({ createdAt: "" }), now)).toBe(true);

    const purged = purgeUnconfirmedRecords(
      [
        row(),
        row({ id: "kept@example.com::m1", createdAt: fresh }),
        row({ id: "renewed@example.com::m1", createdAt: stale, confirmSentAt: fresh }),
        row({ id: "confirmed@example.com::m1", createdAt: stale, confirmed: true }),
      ],
      [
        { subscriberId: row().id, modelId: "old" },
        { subscriberId: "confirmed@example.com::m1", modelId: "stay" },
      ],
      now,
    );
    expect(purged.removed).toBe(1);
    expect(purged.subscribers.map((item) => item.id)).toEqual([
      "kept@example.com::m1",
      "renewed@example.com::m1",
      "confirmed@example.com::m1",
    ]);
    expect(purged.sends).toEqual([{ subscriberId: "confirmed@example.com::m1", modelId: "stay" }]);
    expect(JSON.stringify(purged)).not.toContain("ada@example.com");

    const again = purgeUnconfirmedRecords(purged.subscribers, purged.sends, now);
    expect(again.removed).toBe(0);
    expect(again.subscribers).toEqual(purged.subscribers);
  });

  it("deletes the same rows in sqlite, then deletes nothing on a second run", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE subscribers (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        confirmed INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        confirm_sent_at TEXT
      );
      CREATE TABLE alert_sends (
        subscriber_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        PRIMARY KEY (subscriber_id, model_id)
      );
    `);
    const insert = db.prepare(
      `INSERT INTO subscribers (id, email, confirmed, created_at, confirm_sent_at) VALUES (?, ?, ?, ?, ?)`,
    );
    insert.run("old@example.com::gpu", "old@example.com", 0, stale, stale);
    insert.run("renewed@example.com::gpu", "renewed@example.com", 0, stale, fresh);
    insert.run("fresh@example.com::gpu", "fresh@example.com", 0, fresh, fresh);
    insert.run("confirmed@example.com::gpu", "confirmed@example.com", 1, stale, stale);
    insert.run("garbage@example.com::gpu", "garbage@example.com", 0, "not-a-date", null);
    const send = db.prepare(`INSERT INTO alert_sends (subscriber_id, model_id, sent_at) VALUES (?, ?, ?)`);
    send.run("old@example.com::gpu", "model-a", stale);
    send.run("confirmed@example.com::gpu", "model-b", stale);

    const statements = unconfirmedPurgeStatements(now);
    expect(statements.subscribers).not.toContain("@");
    expect(statements.sends).not.toContain("@");
    const removedSends = db.prepare(statements.sends).run();
    const removedSubscribers = db.prepare(statements.subscribers).run();
    expect(removedSends.changes).toBe(1);
    expect(removedSubscribers.changes).toBe(2);

    const remaining = db.prepare(`SELECT id FROM subscribers ORDER BY id`).all() as { id: string }[];
    expect(remaining.map((item) => item.id)).toEqual([
      "confirmed@example.com::gpu",
      "fresh@example.com::gpu",
      "renewed@example.com::gpu",
    ]);
    const sends = db.prepare(`SELECT subscriber_id, model_id FROM alert_sends`).all() as { subscriber_id: string; model_id: string }[];
    expect(sends).toEqual([{ subscriber_id: "confirmed@example.com::gpu", model_id: "model-b" }]);

    expect(db.prepare(statements.sends).run().changes).toBe(0);
    expect(db.prepare(statements.subscribers).run().changes).toBe(0);
    db.close();
  });
});
