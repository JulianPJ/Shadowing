import { catalogRows, catalogVideos } from './catalog';
import type { Database, Video } from './types';

/**
 * The feed's catalogue join reads about 4.5 D1 rows per candidate. The scheduled refresh runs it
 * and publishes the rows to KV, so feed reads cost no D1 rows however many data centres serve
 * them. Readers map the rows with the deployed code; bump the key when `catalogRows` changes its
 * columns.
 */
export const SNAPSHOT_KEY = 'discover:catalog:v1';
// New acquisitions and refreshed metadata wait for the hourly rebuild. Preparation outcomes,
// verified analyses and removals rebuild at the next 15-minute run.
const REBUILD_MS = 3600000;
// An older snapshot means the scheduled refresh has stopped: read D1 rather than serve it.
const MAX_AGE_MS = 6 * 3600000;

export type SnapshotStore = {
  get(key: string, type: 'json'): Promise<unknown>;
  put(key: string, value: string): Promise<unknown>;
};
type Snapshot = { builtAt: string; rows: Record<string, unknown>[] };

/** Records a feed-visible change made outside the scheduled refresh, such as a preparation. */
export function markCatalogChanged(db: Database, now = Date.now()) {
  return db
    .prepare(
      `INSERT INTO discovery_job_state(key,value_json,updated_at) VALUES('catalog_changed','{}',?)
      ON CONFLICT(key) DO UPDATE SET updated_at=excluded.updated_at`,
    )
    .bind(new Date(now).toISOString());
}

/** Rebuilds when the run changed the catalogue, a change was marked, or hourly. */
export async function publishCatalogSnapshot(
  db: Database,
  store: SnapshotStore,
  now: number,
  changed: boolean,
) {
  const state = await db
    .prepare(
      "SELECT key,updated_at FROM discovery_job_state WHERE key IN ('snapshot','catalog_changed')",
    )
    .all<{ key: string; updated_at: string }>();
  const at = (key: string) =>
    Date.parse(state.results.find((r) => r.key === key)?.updated_at ?? '');
  const built = at('snapshot');
  if (!changed && now - built < REBUILD_MS && !(at('catalog_changed') >= built)) return false;
  const builtAt = new Date(now).toISOString();
  const snapshot: Snapshot = { builtAt, rows: await catalogRows(db, now) };
  await store.put(SNAPSHOT_KEY, JSON.stringify(snapshot));
  await db
    .prepare(
      `INSERT INTO discovery_job_state(key,value_json,updated_at) VALUES('snapshot',?,?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`,
    )
    .bind(JSON.stringify({ rows: snapshot.rows.length }), builtAt)
    .run();
  return true;
}

/** Null when there is no usable snapshot; the caller then reads the catalogue from D1. */
export async function readCatalogSnapshot(
  store: SnapshotStore,
  now = Date.now(),
): Promise<Video[] | null> {
  const snapshot = (await store.get(SNAPSHOT_KEY, 'json').catch(() => null)) as Snapshot | null;
  if (!snapshot || !Array.isArray(snapshot.rows)) return null;
  const age = now - Date.parse(snapshot.builtAt);
  return age >= 0 && age < MAX_AGE_MS ? catalogVideos(snapshot.rows, now) : null;
}
