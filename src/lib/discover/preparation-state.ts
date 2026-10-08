import type { Database } from './types';
/** Observed server outcomes only; the public catalogue is never writable by the browser. */
export async function recordPreparationState(db: Database, videoId: string, code: string | null) {
  const time = new Date().toISOString();
  const status =
    code === null ? 'prepared' : code === 'no-japanese-captions' ? 'needs-captions' : 'failed';
  // Caption absence keeps a useful video visible; content unavailability receives a short cooldown.
  const cooldown =
    code === 'video-unavailable' ? new Date(Date.now() + 15 * 60000).toISOString() : null;
  await db
    .prepare(
      `INSERT INTO discovery_video_state(video_id,preparation_status,last_prepared_at,last_failure_code,cooldown_until)
    SELECT video_id,?,?,?,? FROM discovery_videos WHERE video_id=?
    ON CONFLICT(video_id) DO UPDATE SET preparation_status=excluded.preparation_status,last_prepared_at=excluded.last_prepared_at,
      last_failure_code=excluded.last_failure_code,cooldown_until=excluded.cooldown_until`,
    )
    .bind(status, code === null ? time : null, code, cooldown, videoId)
    .run();
}
