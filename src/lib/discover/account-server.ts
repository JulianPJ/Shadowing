import { readBoundedText, BodyLimitError } from '../http-body';
import { DEFAULT_PREFERENCES, validVideoId, type Database } from './types';
import { validatePreferences } from './validation';
import { readWatchLater, writeWatchLater, validateWatchRecord } from './watch-later';
export async function handleDiscoverAccountRequest(
  request: Request,
  userId: string,
  verified: boolean,
  db: Database,
) {
  const respond = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Cookie' } });
  try {
    const url = new URL(request.url),
      path = url.pathname;
    if (request.method !== 'GET' && !verified)
      return respond({ error: 'Verify your email to sync Discover.' }, 403);
    if (
      request.method !== 'GET' &&
      (request.headers.get('origin') !== url.origin ||
        request.headers.get('content-type')?.split(';')[0] !== 'application/json')
    )
      return respond({ error: 'Invalid origin or content type' }, 403);
    if (path === '/api/discover/preferences') {
      if (request.method === 'GET') {
        const row = await db
          .prepare(
            'SELECT preferences_json,updated_at FROM user_discovery_preferences WHERE user_id=?',
          )
          .bind(userId)
          .first<{ preferences_json: string; updated_at: string }>();
        return respond({
          preferences: row
            ? validatePreferences(JSON.parse(row.preferences_json))
            : DEFAULT_PREFERENCES,
          updatedAt: row?.updated_at ?? null,
        });
      }
      if (request.method === 'PATCH') {
        const preferences = validatePreferences(JSON.parse(await readBoundedText(request, 4096)));
        await db
          .prepare(
            'INSERT INTO user_discovery_preferences(user_id,preferences_json,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET preferences_json=excluded.preferences_json,updated_at=excluded.updated_at',
          )
          .bind(userId, JSON.stringify(preferences), new Date().toISOString())
          .run();
        return respond({ preferences });
      }
    }
    if (path === '/api/watch-later' || path.startsWith('/api/watch-later/')) {
      if (request.method === 'GET' && path === '/api/watch-later')
        return respond({ records: await readWatchLater(db, userId) });
      if (request.method === 'POST' && path === '/api/watch-later') {
        const before = await readWatchLater(db, userId);
        const body = JSON.parse(await readBoundedText(request, 64000));
        if (Array.isArray(body.records))
          await writeWatchLater(
            db,
            userId,
            body.records.map((r: unknown) => validateWatchRecord(r)),
          );
        else {
          if (!validVideoId(body.videoId)) throw new Error('Invalid video');
          const existing = before,
            previous = existing.find((r) => r.videoId === body.videoId);
          const time = new Date().toISOString();
          const title = typeof body.title === 'string' ? body.title.slice(0, 160) : 'Queued video';
          await writeWatchLater(db, userId, [
            {
              videoId: body.videoId,
              title,
              position: previous?.position ?? Math.max(0, ...existing.map((r) => r.position)) + 1,
              addedAt: previous?.addedAt ?? time,
              updatedAt: time,
              removed: false,
            },
          ]);
        }
        const records = await readWatchLater(db, userId);
        const newlySaved = records.filter(
          (r) => !r.removed && !before.some((p) => p.videoId === r.videoId && !p.removed),
        );
        if (newlySaved.length)
          await db.batch(
            newlySaved.map((r) =>
              db
                .prepare(
                  `INSERT OR IGNORE INTO discovery_metric_events(user_id,day,video_id,action)
          SELECT ?,?,video_id,'save' FROM discovery_videos WHERE video_id=?`,
                )
                .bind(userId, new Date().toISOString().slice(0, 10), r.videoId),
            ),
          );
        return respond({ records });
      }
      if (request.method === 'DELETE' && path.startsWith('/api/watch-later/')) {
        const videoId = path.slice('/api/watch-later/'.length);
        if (!validVideoId(videoId)) throw new Error('Invalid video');
        const records = await readWatchLater(db, userId),
          existing = records.find((r) => r.videoId === videoId),
          time = new Date().toISOString();
        if (!existing) return respond({ records });
        await writeWatchLater(db, userId, [
          {
            videoId,
            title: existing?.title ?? 'Queued video',
            position: existing?.position ?? 0,
            addedAt: existing?.addedAt ?? time,
            updatedAt: time,
            removed: true,
          },
        ]);
        return respond({ records: await readWatchLater(db, userId) });
      }
    }
    if (path === '/api/discover/feedback') {
      if (request.method === 'GET') {
        const result = await db
          .prepare(
            'SELECT video_id,action,created_at FROM discovery_feedback WHERE user_id=? AND created_at>? ORDER BY created_at DESC LIMIT 120',
          )
          .bind(userId, new Date(Date.now() - 180 * 86400000).toISOString())
          .all();
        return respond({ feedback: result.results });
      }
      if (request.method === 'POST') {
        const body = JSON.parse(await readBoundedText(request, 1024));
        if (
          !validVideoId(body.videoId) ||
          !['not_interested', 'more_like_this', 'reset'].includes(body.action)
        )
          throw new Error('Invalid feedback');
        await db
          .prepare(
            'INSERT INTO discovery_feedback(user_id,video_id,action,created_at) VALUES(?,?,?,?) ON CONFLICT(user_id,video_id) DO UPDATE SET action=excluded.action,created_at=excluded.created_at',
          )
          .bind(userId, body.videoId, body.action, new Date().toISOString())
          .run();
        return respond({ ok: true });
      }
    }
    if (path === '/api/discover/events' && request.method === 'POST') {
      const body = JSON.parse(await readBoundedText(request, 4096));
      if (!Array.isArray(body.events) || body.events.length > 24) throw new Error('Invalid events');
      const now = Date.now();
      const accepted: { videoId: string; action: string; day: string }[] = [];
      for (const event of body.events) {
        if (
          !validVideoId(event.videoId) ||
          !['impression', 'open', 'prepared', 'complete', 'save'].includes(event.action)
        )
          throw new Error('Invalid event');
        if (
          !(await db
            .prepare('SELECT video_id FROM discovery_videos WHERE video_id=?')
            .bind(event.videoId)
            .first())
        )
          continue;
        if (
          event.action === 'prepared' &&
          !(await db
            .prepare(
              "SELECT content_key FROM linked_transcripts WHERE content_key=? AND visibility='system' AND owner_user_id IS NULL",
            )
            .bind(`youtube:${event.videoId}`)
            .first())
        )
          continue;
        let day = new Date(now).toISOString().slice(0, 10);
        if (event.action === 'complete') {
          const completion = await db
            .prepare(
              "SELECT json_extract(payload_json,'$.completedAt') AS completed_at FROM user_practice_sessions WHERE user_id=? AND json_extract(payload_json,'$.completed')=1 AND lesson_id=? ORDER BY completed_at DESC LIMIT 1",
            )
            .bind(userId, `youtube-${event.videoId}`)
            .first<{ completed_at: string }>();
          const finished = Date.parse(completion?.completed_at ?? '');
          if (
            !Number.isFinite(finished) ||
            finished < now - 30 * 86400000 ||
            finished > now + 300000
          )
            continue;
          // Offline history backfills its actual practice day, never today's popularity.
          day = new Date(finished).toISOString().slice(0, 10);
        }
        if (
          event.action === 'save' &&
          !(await db
            .prepare(
              'SELECT video_id FROM user_watch_later WHERE user_id=? AND video_id=? AND removed=0',
            )
            .bind(userId, event.videoId)
            .first())
        )
          continue;
        accepted.push({ videoId: event.videoId, action: event.action, day });
      }
      if (accepted.length)
        await db.batch(
          accepted.map((e) =>
            db
              .prepare(
                'INSERT OR IGNORE INTO discovery_metric_events(user_id,day,video_id,action) VALUES(?,?,?,?)',
              )
              .bind(userId, e.day, e.videoId, e.action),
          ),
        );
      return respond({ ok: true });
    }
    return respond({ error: 'Method not supported' }, 405);
  } catch (error) {
    const status =
      error instanceof BodyLimitError
        ? 413
        : ((error as { status?: number })?.status ??
          (error instanceof SyntaxError || (error instanceof Error && /Invalid/.test(error.message))
            ? 400
            : 503));
    return respond(
      {
        error:
          status === 409
            ? 'Watch Later has 40 links. Remove one before syncing another.'
            : status === 400
              ? 'Invalid Discover data.'
              : 'Discover sync is temporarily unavailable.',
      },
      status,
    );
  }
}
