/** Matches the 7-day confirmation link. A new confirmation request refreshes confirm_sent_at. */
export const UNCONFIRMED_RETENTION_MS = 7 * 86_400_000;

export interface PurgeSubscriber {
  id: string;
  confirmed: boolean;
  createdAt: string;
  confirmSentAt?: string | null;
}

export interface PurgeSend {
  subscriberId: string;
  modelId: string;
}

/** Latest confirmation attempt, then the original insert. Empty or non-ISO stamps are not kept. */
export function unconfirmedAnchor(row: { createdAt?: string | null; confirmSentAt?: string | null }): string | null {
  const confirm = row.confirmSentAt?.trim() || "";
  const created = row.createdAt?.trim() || "";
  const stamp = confirm || created;
  if (!/^\d{4}-\d{2}-\d{2}/.test(stamp)) return null;
  const parsed = Date.parse(stamp);
  return Number.isFinite(parsed) ? stamp : null;
}

export function shouldPurgeUnconfirmed(
  row: { confirmed: boolean; createdAt?: string | null; confirmSentAt?: string | null },
  now: number,
): boolean {
  if (row.confirmed) return false;
  const stamp = unconfirmedAnchor(row);
  if (!stamp) return true;
  return Date.parse(stamp) <= now - UNCONFIRMED_RETENTION_MS;
}

export function purgeUnconfirmedRecords<T extends PurgeSubscriber>(
  subscribers: T[],
  sends: PurgeSend[],
  now: number,
): { subscribers: T[]; sends: PurgeSend[]; removed: number } {
  const removedIds = new Set(subscribers.filter((row) => shouldPurgeUnconfirmed(row, now)).map((row) => row.id));
  return {
    subscribers: subscribers.filter((row) => !removedIds.has(row.id)),
    sends: sends.filter((row) => !removedIds.has(row.subscriberId)),
    removed: removedIds.size,
  };
}

/**
 * D1 statements for the watcher. Idempotent: a second run deletes nothing.
 * The cutoff is generated here, never taken from a request.
 * Rows that asked for a new confirmation inside the window are kept via confirm_sent_at.
 */
export function unconfirmedPurgeStatements(now: number): { sends: string; subscribers: string } {
  const cutoff = new Date(now - UNCONFIRMED_RETENTION_MS).toISOString().replaceAll("'", "''");
  const anchor = `COALESCE(NULLIF(confirm_sent_at, ''), NULLIF(created_at, ''))`;
  const stale = `confirmed = 0 AND (
    ${anchor} IS NULL
    OR ${anchor} NOT GLOB '????-??-??*'
    OR ${anchor} <= '${cutoff}'
  )`;
  return {
    sends: `DELETE FROM alert_sends WHERE subscriber_id IN (SELECT id FROM subscribers WHERE ${stale})`,
    subscribers: `DELETE FROM subscribers WHERE ${stale}`,
  };
}
