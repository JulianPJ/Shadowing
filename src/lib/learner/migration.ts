import { sha256 } from '../hash';
import { transcriptKey, transcriptRevision } from '../transcript';
import { object } from '../transcript-validation';
import { readStorage, storageKeys } from '../storage/browser';
import { writeLearnerHistory, loadDifficulty } from '../storage/learning';
import { compactDifficulty, identityKey, lessonIdentity } from './constants';
import { createSession, sectionActivity } from './sessions';
import type { LearnerHistory } from '../learner-types';
import { loadLearnerHistory, savePracticeSession } from './persistence';
import { loadQuizHistory } from './quiz-history';
import { availableLesson } from './bookmarks';
import { storageAccount } from '../storage/browser';
export async function legacyId(key: string) {
  const hex = await sha256(`hibiki-legacy-v1:${key}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// Scan uncapped lesson:* storage, not just recent history. Repeat safely to pick
// up old data not encountered before; deterministic IDs and a per-revision marker
// prevent fabrication or duplicate backfill. No legacy active time is invented.
export async function migrateLearnerHistory(): Promise<LearnerHistory> {
  // Account caches must never backfill from unrelated anonymous/private lessons.
  if (storageAccount()) return loadLearnerHistory();
  const ids = new Set(
    storageKeys()
      .filter((k) => k.startsWith('lesson:'))
      .map((k) => k.slice(7)),
  );
  const rawRecent = readStorage<unknown>('history', []),
    recent = Array.isArray(rawRecent) ? rawRecent : [];
  for (const value of recent) {
    try {
      const r = object(value),
        l = object(r.lesson);
      if (typeof l.id === 'string') ids.add(l.id);
    } catch {
      /* ignore */
    }
  }
  const attempts = loadQuizHistory();
  for (const a of attempts) ids.add(a.lessonId);
  // Demo is available without saving lesson data, but opening Progress alone
  // must not fabricate a demo activity record.
  if (storageKeys().some((k) => /^(completion|favorites|position|reveal):demo(?:$|:)/.test(k)))
    ids.add('demo');
  for (const id of ids) {
    if (readStorage(`lesson-visibility:${id}`, null) === 'account-only') continue;
    const lesson = availableLesson(id);
    if (!lesson) continue;
    const key = await transcriptKey(lesson),
      identity = lessonIdentity(lesson, key);
    if (storageAccount()) return loadLearnerHistory();
    const history = loadLearnerHistory(),
      known =
        history.sessions.some((s) => identityKey(s.lesson) === identityKey(identity)) ||
        history.archives.some((a) => identityKey(a.lesson) === identityKey(identity));
    if (!known) {
      const completion = readStorage<{ transcript?: unknown; completedAt?: unknown } | null>(
        `completion:${id}`,
        null,
      );
      const iso = (v: unknown): string | null =>
        typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v
          ? v
          : null;
      const completedAt =
        completion?.transcript === transcriptRevision(lesson) ? iso(completion.completedAt) : null;
      const recentRecord = recent.find((value) => {
        try {
          return object(object(value).lesson).id === id;
        } catch {
          return false;
        }
      });
      const updated = recentRecord ? object(recentRecord).updatedAt : undefined;
      const updatedAt =
        typeof updated === 'number' &&
        Number.isFinite(updated) &&
        updated >= 0 &&
        updated <= 8640000000000000
          ? new Date(updated).toISOString()
          : null;
      const attemptDate =
        attempts
          .filter((a) => a.lessonId === id && a.transcriptKey === key)
          .map((a) => a.updatedAt)
          .sort()
          .at(-1) ?? null;
      const dates = [completedAt, updatedAt, attemptDate].filter((d): d is string => !!d).sort();
      // No date available: preserve bookmark/reveal state via a deterministic
      // epoch observation, explicitly labelled legacy, never a practice timestamp.
      const s = createSession(
        identity,
        dates.at(-1) ?? '1970-01-01T00:00:00.000Z',
        await legacyId(identityKey(identity)),
      );
      if (storageAccount()) return loadLearnerHistory();
      s.origin = 'legacy';
      s.startedAt = null;
      s.completedAt = completedAt;
      s.completed = completion?.transcript === transcriptRevision(lesson);
      const position = readStorage<unknown>(`position:${id}`, null);
      if (typeof position === 'number' && Number.isInteger(position) && lesson.segments[position])
        s.lastSectionId = lesson.segments[position].id;
      const favorites = readStorage<unknown>(`favorites:${id}`, []);
      for (const segment of lesson.segments) {
        const translationHelp = readStorage<unknown>(`reveal:${id}:${segment.id}`, false) === true;
        if (translationHelp || (Array.isArray(favorites) && favorites.includes(segment.id)))
          s.sections.push({ ...sectionActivity(segment), translationHelp });
      }
      savePracticeSession(s);
    }
    const analysis = await loadDifficulty(lesson);
    if (storageAccount()) return loadLearnerHistory();
    if (analysis) {
      // Re-read after awaits: never overwrite a concurrent session checkpoint.
      const current = loadLearnerHistory();
      if (!current.difficulties.some((d) => d.id === analysis.id)) {
        current.difficulties.push(compactDifficulty(analysis));
        writeLearnerHistory(current);
      }
    }
  }
  return loadLearnerHistory();
}
