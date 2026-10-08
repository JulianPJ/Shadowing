import {
  count,
  date,
  fingerprint,
  str,
  strict,
  validateDifficultyReference,
  validateIdentity,
  validateSession,
} from '../learner/validation';
import { identityKey, validateHistory } from '../learner-progress';
import { validContentKey } from '../linked-transcripts';
import { QUESTION_KINDS } from '../quiz';
import { validateReviewLimits } from '../review/limits';
import {
  emptySync,
  syncCollections,
  type SyncData,
  type SyncedAttempt,
  type SyncedBookmark,
  type SyncedLesson,
} from './types';
export function bookmarkId(lessonId: string, transcriptKey: string, sectionId: string) {
  return JSON.stringify([lessonId, transcriptKey, sectionId]);
}
export function lessonSyncId(lessonId: string, transcriptKey: string) {
  return identityKey({ lessonId, transcriptKey });
}
const bool = (v: unknown) => {
  if (typeof v !== 'boolean') throw new Error('Invalid boolean');
  return v;
};
const nullable = (v: unknown) => (v === null ? null : str(v, 200));
export function safeMetadata(s: string) {
  // Metadata is never a route to storing URLs, object URLs, paths or provider access hashes.
  if (/(?:https?:|blob:|file:|[a-z]:[\\/]|[?&](?:token|signature|hash|key)=)/i.test(s))
    throw new Error('Unsafe metadata');
  return s;
}
export function safeIdentity(v: unknown) {
  const lesson = validateIdentity(v);
  [lesson.lessonId, lesson.title, lesson.author].forEach(safeMetadata);
  if (lesson.videoId && !/^[\w-]{1,100}$/.test(lesson.videoId))
    throw new Error('Unsafe provider ID');
  return lesson;
}
export function validateSyncedAttempt(value: unknown): SyncedAttempt {
  const r = strict(value, [
    'schemaVersion',
    'id',
    'lessonId',
    'videoId',
    'quizId',
    'transcriptKey',
    'contentKey',
    'startedAt',
    'updatedAt',
    'completedAt',
    'totalQuestions',
    'score',
    'verified',
    'results',
  ]);
  const lessonId = safeMetadata(str(r.lessonId, 200)),
    key = fingerprint(r.transcriptKey);
  if (r.schemaVersion !== 1 || !Array.isArray(r.results) || r.results.length > 7)
    throw new Error('Invalid attempt');
  const startedAt = date(r.startedAt),
    updatedAt = date(r.updatedAt),
    completedAt = r.completedAt === null ? null : date(r.completedAt);
  const total = count(r.totalQuestions, true);
  if (
    total < 3 ||
    total > 7 ||
    r.results.length > total ||
    startedAt > updatedAt ||
    (completedAt &&
      (completedAt < startedAt || completedAt > updatedAt || r.results.length !== total))
  )
    throw new Error('Invalid attempt bounds');
  const results = r.results.map((v, i) => {
    const a = strict(v, [
        'questionId',
        'kind',
        'selectedIndex',
        'correctIndex',
        'correct',
        'evidence',
      ]),
      e = strict(a.evidence, ['segmentIds', 'start', 'end']);
    if (
      a.questionId !== `question-${i + 1}` ||
      !QUESTION_KINDS.includes(a.kind as never) ||
      ![0, 1, 2, 3].includes(a.selectedIndex as number) ||
      ![0, 1, 2, 3].includes(a.correctIndex as number) ||
      a.correct !== (a.selectedIndex === a.correctIndex) ||
      !Array.isArray(e.segmentIds) ||
      !e.segmentIds.length ||
      e.segmentIds.length > 24
    )
      throw new Error('Invalid answer');
    const start = count(e.start),
      end = count(e.end);
    if (end <= start || end > 86400) throw new Error('Invalid evidence bounds');
    return {
      questionId: a.questionId,
      kind: a.kind,
      selectedIndex: a.selectedIndex,
      correctIndex: a.correctIndex,
      correct: a.correct,
      evidence: { segmentIds: e.segmentIds.map((x) => safeMetadata(str(x, 200))), start, end },
    } as SyncedAttempt['results'][number];
  });
  if (r.score !== results.filter((a) => a.correct).length) throw new Error('Invalid score');
  if (r.contentKey !== null && !validContentKey(r.contentKey)) throw new Error('Invalid content');
  return {
    schemaVersion: 1,
    id: safeMetadata(str(r.id, 200)),
    lessonId,
    transcriptKey: key,
    quizId: safeMetadata(str(r.quizId, 200)),
    contentKey: r.contentKey as string | null,
    startedAt,
    updatedAt,
    completedAt,
    totalQuestions: total,
    score: r.score as number,
    verified: bool(r.verified),
    results,
    ...(r.videoId === undefined ? {} : { videoId: safeMetadata(str(r.videoId, 100)) }),
  };
}
export function validateSync(value: unknown, now = Date.now()): SyncData {
  const r = strict(value, ['preferences', ...syncCollections]),
    result = emptySync();
  if (r.preferences !== null) {
    const p = strict(r.preferences, [
      'schemaVersion',
      'mode',
      'speed',
      'studioMode',
      'furigana',
      'reviewLimits',
      'updatedAt',
    ]);
    if (
      p.schemaVersion !== 1 ||
      !['shadowing', 'continuous'].includes(p.mode as string) ||
      ![0.5, 0.75, 1, 1.25].includes(p.speed as number)
    )
      throw new Error('Invalid preferences');
    result.preferences = {
      schemaVersion: 1,
      mode: p.mode as 'shadowing' | 'continuous',
      speed: p.speed as number,
      studioMode: bool(p.studioMode),
      furigana: bool(p.furigana),
      ...(p.reviewLimits === undefined
        ? {}
        : { reviewLimits: validateReviewLimits(p.reviewLimits) }),
      updatedAt: date(p.updatedAt),
    };
  }
  for (const kind of syncCollections) {
    if (!Array.isArray(r[kind]) || r[kind].length > 50) throw new Error('Batch too large');
  }
  result.sessions = (r.sessions as unknown[]).map((v) => {
    const s = validateSession(v);
    s.lesson = safeIdentity(s.lesson);
    if (s.lastSectionId) safeMetadata(s.lastSectionId);
    s.sections.forEach((section) => safeMetadata(section.sectionId));
    return s;
  });
  result.difficulties = (r.difficulties as unknown[]).map((value) => {
    const reference = validateDifficultyReference(value);
    safeMetadata(reference.lessonId);
    return reference;
  });
  result.attempts = (r.attempts as unknown[]).map(validateSyncedAttempt);
  result.lessons = (r.lessons as unknown[]).map((v) => {
    const l = strict(v, [
        'id',
        'lesson',
        'contentKey',
        'providerMediaId',
        'mediaAvailable',
        'lastSectionId',
        'position',
        'updatedAt',
        'completed',
        'completedAt',
      ]),
      lesson = safeIdentity(l.lesson);
    if (
      l.id !== lessonSyncId(lesson.lessonId, lesson.transcriptKey) ||
      (l.contentKey !== null && !validContentKey(l.contentKey))
    )
      throw new Error('Invalid lesson reference');
    const providerMediaId = nullable(l.providerMediaId),
      position = count(l.position, true);
    if (
      (providerMediaId && !/^[\w-]{1,100}$/.test(providerMediaId)) ||
      position >= lesson.segmentCount
    )
      throw new Error('Invalid media identity');
    if (['direct', 'upload', 'vimeo'].includes(lesson.source) && l.mediaAvailable !== false)
      throw new Error('Media requires reattachment');
    const updatedAt = date(l.updatedAt),
      completedAt = l.completedAt === null ? null : date(l.completedAt),
      completed = bool(l.completed);
    if ((completedAt && (!completed || completedAt > updatedAt)) || (completed && !completedAt))
      throw new Error('Invalid completion');
    return {
      id: l.id,
      lesson,
      contentKey: l.contentKey,
      providerMediaId,
      mediaAvailable: bool(l.mediaAvailable),
      lastSectionId: l.lastSectionId === null ? null : safeMetadata(str(l.lastSectionId, 200)),
      position,
      updatedAt,
      completed,
      completedAt,
    } as SyncedLesson;
  });
  result.bookmarks = (r.bookmarks as unknown[]).map((v) => {
    const b = strict(v, ['id', 'lesson', 'sectionId', 'start', 'end', 'updatedAt', 'deleted']),
      lesson = safeIdentity(b.lesson),
      sectionId = safeMetadata(str(b.sectionId, 200)),
      start = count(b.start),
      end = count(b.end);
    if (
      b.id !== bookmarkId(lesson.lessonId, lesson.transcriptKey, sectionId) ||
      end <= start ||
      end > lesson.duration
    )
      throw new Error('Invalid bookmark');
    return {
      id: b.id,
      lesson,
      sectionId,
      start,
      end,
      updatedAt: date(b.updatedAt),
      deleted: bool(b.deleted),
    } as SyncedBookmark;
  });
  result.archives = (r.archives as unknown[]).map((v) => {
    const a = strict(v, ['id', 'archive', 'updatedAt']),
      h = validateHistory({
        schemaVersion: 1,
        migrationVersion: 1,
        sessions: [],
        archives: [a.archive],
        difficulties: [],
      });
    if (h.archives.length !== 1) throw new Error('Invalid archive');
    h.archives[0].lesson = safeIdentity(h.archives[0].lesson);
    h.archives[0].activity.lesson = safeIdentity(h.archives[0].activity.lesson);
    const activity = h.archives[0].activity;
    if (activity.lastSectionId) safeMetadata(activity.lastSectionId);
    activity.sections.forEach((section) => safeMetadata(section.sectionId));
    return {
      id: safeMetadata(str(a.id, 500)),
      archive: h.archives[0],
      updatedAt: date(a.updatedAt),
    };
  });
  for (const time of [
    result.preferences?.updatedAt,
    ...syncCollections.flatMap((k) =>
      result[k].map((x) => ('generatedAt' in x ? x.generatedAt : x.updatedAt)),
    ),
  ]) {
    if (time && Date.parse(time) > now + 5 * 60 * 1000) throw new Error('Future timestamp');
  }
  return result;
}
