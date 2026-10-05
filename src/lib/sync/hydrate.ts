import { readStorage, writeStorage, storageAccount } from '../storage/browser';
import { availableLesson } from '../learner/bookmarks';
import { loadLearnerHistory } from '../learner/persistence';
import { loadQuizHistory } from '../learner/quiz-history';
import { upsertSession } from '../learner/sessions';
import { transcriptKey, transcriptRevision } from '../transcript';
import type { SyncData } from './types';

export async function hydrateSync(data: SyncData) {
  const owner = storageAccount();
  if (data.preferences) {
    const { updatedAt, mode, speed, studioMode, furigana } = data.preferences;
    writeStorage('preferences', { mode, speed, studioMode, furigana, translation: false });
    writeStorage('sync:preferences-date', updatedAt);
  }
  // Reconstruct the existing learner domain, keeping UUIDs and distinct retakes.
  const history = loadLearnerHistory();
  for (const session of data.sessions) upsertSession(history, session);
  history.difficulties = data.difficulties;
  history.archives = data.archives.map((a) => a.archive);
  writeStorage('learner-history', history);
  const localAttempts = loadQuizHistory();
  const attempts = data.attempts.map((a) => {
    const local = localAttempts.find((x) => x.id === a.id);
    return {
      schemaVersion: 1,
      id: a.id,
      lessonId: a.lessonId,
      ...(a.videoId ? { videoId: a.videoId } : {}),
      quizId: a.quizId,
      transcriptKey: a.transcriptKey,
      quizAttempted: true,
      startedAt: a.startedAt,
      updatedAt: a.updatedAt,
      completedAt: a.completedAt,
      score: a.score,
      totalQuestions: a.totalQuestions,
      results: a.results.map((r, i) => ({
        ...r,
        evidence: {
          ...r.evidence,
          quote: local?.results[i]?.evidence.quote ?? 'Evidence remains on the original device.',
        },
      })),
    };
  });
  writeStorage('quiz-attempts', attempts);
  for (const attempt of attempts) {
    const old = readStorage<{ updatedAt: string } | null>(`quiz-attempt:${attempt.quizId}`, null);
    if (!old || old.updatedAt <= attempt.updatedAt)
      writeStorage(`quiz-attempt:${attempt.quizId}`, attempt);
  }
  for (const reference of data.lessons) {
    const lesson = availableLesson(reference.lesson.lessonId);
    if (!lesson || (await transcriptKey(lesson)) !== reference.lesson.transcriptKey) continue;
    if (storageAccount() !== owner) return;
    writeStorage(`position:${lesson.id}`, reference.position);
    if (reference.completed)
      writeStorage(`completion:${lesson.id}`, {
        lessonId: lesson.id,
        transcript: transcriptRevision(lesson),
        completedAt: reference.completedAt,
      });
  }
  const ids = new Set(data.bookmarks.map((b) => b.lesson.lessonId));
  for (const id of ids) {
    const lesson = availableLesson(id);
    if (!lesson) continue;
    const key = await transcriptKey(lesson),
      rows = data.bookmarks.filter(
        (b) => b.lesson.lessonId === id && b.lesson.transcriptKey === key,
      );
    if (storageAccount() !== owner) return;
    writeStorage(
      `favorites:${id}`,
      rows.filter((b) => !b.deleted).map((b) => b.sectionId),
    );
    writeStorage(
      `sync:bookmark-dates:${id}`,
      Object.fromEntries(
        rows.map((b) => [b.sectionId, { updatedAt: b.updatedAt, deleted: b.deleted }]),
      ),
    );
  }
  window.dispatchEvent(new Event('hibiki:sync-hydrated'));
}
