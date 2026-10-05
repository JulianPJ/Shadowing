import { readStorage, storageKeys, writeStorage, storageAccount } from '../storage/browser';
import { loadPreferences } from '../storage/preferences';
import { loadLearnerHistory } from '../learner/persistence';
import { availableLesson } from '../learner/bookmarks';
import { loadQuizHistory } from '../learner/quiz-history';
import { lessonIdentity } from '../learner/constants';
import { transcriptKey, transcriptRevision } from '../transcript';
import { bookmarkId, lessonSyncId, safeIdentity } from './validation';
import { emptySync, type SyncData } from './types';
import { sanitizeDeviceData } from './sanitize';

export async function deviceSnapshot(): Promise<SyncData> {
  const owner = storageAccount();
  const result = emptySync(),
    history = loadLearnerHistory();
  result.sessions = history.sessions.flatMap((s) => {
    try {
      return [{ ...s, lesson: safeIdentity(s.lesson) }];
    } catch {
      return [];
    }
  });
  result.difficulties = history.difficulties;
  const deviceId = readStorage<string>('sync-device', '') || crypto.randomUUID();
  writeStorage('sync-device', deviceId);
  result.archives = history.archives.map((archive) => ({
    id: `${deviceId}:${lessonSyncId(archive.lesson.lessonId, archive.lesson.transcriptKey)}`,
    archive,
    updatedAt: archive.activity.updatedAt,
  }));
  const preferencesDate = readStorage<string | null>('sync:preferences-date', null);
  if (preferencesDate || storageKeys().includes('preferences')) {
    const { mode, speed, studioMode, furigana } = loadPreferences();
    result.preferences = {
      schemaVersion: 1,
      mode,
      speed,
      studioMode,
      furigana,
      updatedAt: preferencesDate ?? new Date(0).toISOString(),
    };
  }
  const ids = new Set([
    ...storageKeys()
      .filter((k) => k.startsWith('lesson:'))
      .map((k) => k.slice(7)),
    ...result.sessions.map((s) => s.lesson.lessonId),
  ]);
  // Authenticated snapshots include only lessons actually visited on this account.
  const recent = readStorage<{ lesson: { id: string }; updatedAt: number }[]>('history', []);
  for (const id of ids) {
    if (!storageAccount() && readStorage(`lesson-visibility:${id}`, null) === 'account-only')
      continue;
    const lesson = availableLesson(id);
    if (!lesson) continue;
    const visit = Array.isArray(recent) ? recent.find((r) => r.lesson?.id === id) : undefined;
    if (storageAccount() && !visit && !result.sessions.some((s) => s.lesson.lessonId === id))
      continue;
    try {
      const key = await transcriptKey(lesson),
        identity = safeIdentity(lessonIdentity(lesson, key)),
        media = lesson.mediaSource;
      const contentKey =
        media && 'contentKey' in media
          ? media.contentKey
          : lesson.source === 'youtube' && lesson.videoId
            ? `youtube:${lesson.videoId}`
            : null;
      const position = readStorage<number>(`position:${id}`, 0),
        completion = readStorage<{ transcript: string; completedAt: string } | null>(
          `completion:${id}`,
          null,
        );
      const completed = completion?.transcript === transcriptRevision(lesson);
      const updatedAt =
        [
          readStorage<string | null>(`sync:lesson-date:${id}`, null),
          visit ? new Date(visit.updatedAt).toISOString() : null,
          completed ? completion!.completedAt : null,
        ]
          .filter((date): date is string => !!date)
          .sort()
          .at(-1) ?? new Date(0).toISOString();
      result.lessons.push({
        id: lessonSyncId(id, key),
        lesson: identity,
        contentKey,
        providerMediaId: lesson.videoId ?? null,
        mediaAvailable: ['youtube', 'demo'].includes(lesson.source),
        lastSectionId: lesson.segments[position]?.id ?? null,
        position: Math.max(0, Math.min(position, lesson.segments.length - 1)),
        updatedAt,
        completed,
        completedAt: completed ? completion!.completedAt : null,
      });
      const favorites = readStorage<string[]>(`favorites:${id}`, []);
      const dates = readStorage<Record<string, { updatedAt: string; deleted: boolean }>>(
        `sync:bookmark-dates:${id}`,
        {},
      );
      for (const section of lesson.segments) {
        const state = dates[section.id],
          selected = Array.isArray(favorites) && favorites.includes(section.id);
        if (!state && !selected) continue;
        result.bookmarks.push({
          id: bookmarkId(id, key, section.id),
          lesson: identity,
          sectionId: section.id,
          start: section.start,
          end: section.end,
          updatedAt: state?.updatedAt ?? new Date(0).toISOString(),
          deleted: state?.deleted ?? false,
        });
      }
    } catch {
      /* Unsafe metadata never becomes a sync payload. */
    }
  }
  result.attempts = loadQuizHistory().map((a) => ({
    schemaVersion: 1,
    id: a.id,
    lessonId: a.lessonId,
    ...(a.videoId ? { videoId: a.videoId } : {}),
    quizId: a.quizId,
    transcriptKey: a.transcriptKey,
    contentKey:
      result.lessons.find(
        (l) => l.lesson.lessonId === a.lessonId && l.lesson.transcriptKey === a.transcriptKey,
      )?.contentKey ?? null,
    startedAt: a.startedAt,
    updatedAt: a.updatedAt,
    completedAt: a.completedAt,
    totalQuestions: a.totalQuestions,
    score: a.score,
    verified: false,
    results: a.results.map(({ evidence, ...r }) => ({
      ...r,
      evidence: { segmentIds: evidence.segmentIds, start: evidence.start, end: evidence.end },
    })),
  }));
  return owner === storageAccount() ? sanitizeDeviceData(result) : emptySync();
}
