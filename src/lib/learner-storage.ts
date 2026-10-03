import demo from '@/data/demo.json';
import { transcriptKey, transcriptRevision, validateQuizLesson, object, QUESTION_KINDS } from './quiz';
import { readStorage, writeLearnerHistory, storageKeys, loadDifficulty, reportStorageFailure } from './storage';
import { compactDifficulty, createSession, emptyHistory, identityKey, lessonIdentity, sectionActivity, upsertSession, validateHistory, validateSession } from './learner-progress';
import type { BookmarkSnapshot, LearnerHistory, LessonIdentity, PracticeSession } from './learner-types';
import type { Lesson, QuizAttempt, QuizAnswerResult } from './types';

export function loadLearnerHistory(): LearnerHistory { return validateHistory(readStorage('learner-history', emptyHistory())); }
export function savePracticeSession(session: PracticeSession): boolean {
  try {
    const history = loadLearnerHistory(); upsertSession(history, validateSession(session));
    return writeLearnerHistory(history, session.id);
  } catch { reportStorageFailure(); return false; }
}
// Existing quiz history is the sole source. Validate portable attempts even when
// the old lesson/quiz revision is no longer present; never duplicate their content.
export function loadQuizHistory(): QuizAttempt[] {
  const values = readStorage<unknown>('quiz-attempts', []);
  if (!Array.isArray(values)) return [];
  const results: QuizAttempt[] = [];
  const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
  const text = (v: unknown, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max;
  for (const value of values) {
    try {
      const r = object(value);
      if (r.schemaVersion !== 1 || r.quizAttempted !== true || !text(r.id) || !text(r.lessonId) || !text(r.quizId) || typeof r.transcriptKey !== 'string' || !/^[a-f0-9]{64}$/.test(r.transcriptKey) || (r.videoId !== undefined && !text(r.videoId, 100)) || !date(r.startedAt) || !date(r.updatedAt) || r.updatedAt < r.startedAt || (r.completedAt !== null && (!date(r.completedAt) || r.completedAt < r.startedAt || r.completedAt > r.updatedAt)) || !Number.isInteger(r.totalQuestions) || (r.totalQuestions as number) < 3 || (r.totalQuestions as number) > 7 || !Array.isArray(r.results) || r.results.length > (r.totalQuestions as number) || (r.completedAt && r.results.length !== r.totalQuestions)) continue;
      const answers: QuizAnswerResult[] = r.results.map((value, i) => {
        const a = object(value), e = object(a.evidence);
        if (a.questionId !== `question-${i + 1}` || !QUESTION_KINDS.includes(a.kind as QuizAnswerResult['kind']) || ![0, 1, 2, 3].includes(a.selectedIndex as number) || ![0, 1, 2, 3].includes(a.correctIndex as number) || a.correct !== (a.selectedIndex === a.correctIndex) || !Array.isArray(e.segmentIds) || !e.segmentIds.length || e.segmentIds.length > 24 || !e.segmentIds.every(id => text(id)) || new Set(e.segmentIds).size !== e.segmentIds.length || !text(e.quote, 120000) || typeof e.start !== 'number' || typeof e.end !== 'number' || !Number.isFinite(e.start) || !Number.isFinite(e.end) || e.start < 0 || e.end <= e.start || e.end > 86400) throw new Error('Invalid quiz result');
        return { questionId: a.questionId, kind: a.kind, selectedIndex: a.selectedIndex, correctIndex: a.correctIndex, correct: a.correct, evidence: { segmentIds: e.segmentIds, quote: e.quote, start: e.start, end: e.end } } as QuizAnswerResult;
      });
      if (r.score !== answers.filter(a => a.correct).length) continue;
      results.push({ schemaVersion: 1, id: r.id, lessonId: r.lessonId, ...(r.videoId ? { videoId: r.videoId } : {}), quizId: r.quizId, transcriptKey: r.transcriptKey, quizAttempted: true, startedAt: r.startedAt, updatedAt: r.updatedAt, completedAt: r.completedAt, score: r.score, totalQuestions: r.totalQuestions, results: answers } as QuizAttempt);
    } catch { /* One malformed attempt does not hide valid retakes. */ }
  }
  return results;
}
export function availableLesson(id: string): Lesson | null {
  try {
    const value = id === 'demo' ? demo : readStorage(`lesson:${id}`, null), r = object(value);
    const normalized = validateQuizLesson(r, { maxSegments: 10000, maxCharacters: 300000 });
    if (normalized.id !== id || typeof r.title !== 'string' || !r.title.trim() || typeof r.author !== 'string' || !['demo', 'youtube', 'upload'].includes(r.source as string)) return null;
    return { ...r, ...normalized } as Lesson;
  } catch { return null; }
}
export async function currentBookmarks(identities: LessonIdentity[], history?: LearnerHistory): Promise<BookmarkSnapshot[]> {
  const result: BookmarkSnapshot[] = [], seen = new Set<string>();
  for (const identity of identities) {
    if (seen.has(identity.lessonId)) continue;
    seen.add(identity.lessonId);
    const lesson = availableLesson(identity.lessonId);
    if (!lesson) {
      const records = [...(history?.sessions ?? []), ...(history?.archives.map(a => a.activity) ?? [])].filter(s => s.lesson.lessonId === identity.lessonId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const latest = records[0]; if (!latest) continue;
      const raw = readStorage<unknown>(`favorites:${identity.lessonId}`, []), ids = new Set(Array.isArray(raw) ? raw : []);
      const sections = new Map(records.filter(s => s.lesson.transcriptKey === latest.lesson.transcriptKey).flatMap(s => s.sections).filter(s => ids.has(s.sectionId)).map(s => [s.sectionId, { sectionId: s.sectionId, start: s.start, end: s.end }]));
      result.push({ lesson: latest.lesson, sections: [...sections.values()] }); continue;
    }
    const current = lessonIdentity(lesson, await transcriptKey(lesson));
    const raw = readStorage<unknown>(`favorites:${lesson.id}`, []), ids = Array.isArray(raw) ? new Set(raw.filter(id => typeof id === 'string')) : new Set();
    result.push({ lesson: current, sections: lesson.segments.filter(s => ids.has(s.id)).map(s => ({ sectionId: s.id, start: s.start, end: s.end })) });
  }
  return result;
}
async function legacyId(key: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`hibiki-legacy-v1:${key}`));
  const hex = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
// Scan uncapped lesson:* storage, not just recent history. Repeat safely to pick
// up old data not encountered before; deterministic IDs and a per-revision marker
// prevent fabrication or duplicate backfill. No legacy active time is invented.
export async function migrateLearnerHistory(): Promise<LearnerHistory> {
  const ids = new Set(storageKeys().filter(k => k.startsWith('lesson:')).map(k => k.slice(7)));
  const rawRecent = readStorage<unknown>('history', []), recent = Array.isArray(rawRecent) ? rawRecent : [];
  for (const value of recent) { try { const r = object(value), l = object(r.lesson); if (typeof l.id === 'string') ids.add(l.id); } catch { /* ignore */ } }
  const attempts = loadQuizHistory(); for (const a of attempts) ids.add(a.lessonId);
  // Demo is available without saving lesson data, but opening Progress alone
  // must not fabricate a demo activity record.
  if (storageKeys().some(k => /^(completion|favorites|position|reveal):demo(?:$|:)/.test(k))) ids.add('demo');
  for (const id of ids) {
    const lesson = availableLesson(id); if (!lesson) continue;
    const key = await transcriptKey(lesson), identity = lessonIdentity(lesson, key);
    const history = loadLearnerHistory(), known = history.sessions.some(s => identityKey(s.lesson) === identityKey(identity)) || history.archives.some(a => identityKey(a.lesson) === identityKey(identity));
    if (!known) {
      const completion = readStorage<{ transcript?: unknown; completedAt?: unknown } | null>(`completion:${id}`, null);
      const iso = (v: unknown): string | null => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v ? v : null;
      const completedAt = completion?.transcript === transcriptRevision(lesson) ? iso(completion.completedAt) : null;
      const recentRecord = recent.find(value => { try { return object(object(value).lesson).id === id; } catch { return false; } });
      const updated = recentRecord ? object(recentRecord).updatedAt : undefined;
      const updatedAt = typeof updated === 'number' && Number.isFinite(updated) && updated >= 0 && updated <= 8640000000000000 ? new Date(updated).toISOString() : null;
      const attemptDate = attempts.filter(a => a.lessonId === id && a.transcriptKey === key).map(a => a.updatedAt).sort().at(-1) ?? null;
      const dates = [completedAt, updatedAt, attemptDate].filter((d): d is string => !!d).sort();
      // No date available: preserve bookmark/reveal state via a deterministic
      // epoch observation, explicitly labelled legacy, never a practice timestamp.
      const s = createSession(identity, dates.at(-1) ?? '1970-01-01T00:00:00.000Z', await legacyId(identityKey(identity)));
      s.origin = 'legacy'; s.startedAt = null; s.completedAt = completedAt; s.completed = completion?.transcript === transcriptRevision(lesson);
      const position = readStorage<unknown>(`position:${id}`, null);
      if (typeof position === 'number' && Number.isInteger(position) && lesson.segments[position]) s.lastSectionId = lesson.segments[position].id;
      const favorites = readStorage<unknown>(`favorites:${id}`, []);
      for (const segment of lesson.segments) {
        const translationHelp = readStorage<unknown>(`reveal:${id}:${segment.id}`, false) === true;
        if (translationHelp || (Array.isArray(favorites) && favorites.includes(segment.id))) s.sections.push({ ...sectionActivity(segment), translationHelp });
      }
      savePracticeSession(s);
    }
    const analysis = await loadDifficulty(lesson);
    if (analysis) {
      // Re-read after awaits: never overwrite a concurrent session checkpoint.
      const current = loadLearnerHistory();
      if (!current.difficulties.some(d => d.id === analysis.id)) { current.difficulties.push(compactDifficulty(analysis)); writeLearnerHistory(current); }
    }
  }
  return loadLearnerHistory();
}
