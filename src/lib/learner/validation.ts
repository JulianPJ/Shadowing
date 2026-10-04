import type { Lesson } from '../types';
import type {
  DifficultyReference,
  LearnerHistory,
  LessonIdentity,
  PracticeSession,
  SectionActivity,
} from '../learner-types';
import { JLPT_LEVELS, identityKey, emptyHistory } from './constants';
import { upsertSession } from './sessions';
export const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid learner record');
  return v as Record<string, unknown>;
};

export function strict(v: unknown, fields: string[]) {
  const r = obj(v);
  if (Object.keys(r).some((k) => !fields.includes(k))) throw new Error('Unexpected learner fields');
  return r;
}

export function str(v: unknown, max = 500): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error('Invalid string');
  return v;
}

export function count(v: unknown, integer = false): number {
  if (
    typeof v !== 'number' ||
    !Number.isFinite(v) ||
    v < 0 ||
    (integer && !Number.isSafeInteger(v))
  )
    throw new Error('Invalid number');
  return v;
}

export function date(v: unknown): string {
  const s = str(v, 24);
  if (!Number.isFinite(Date.parse(s)) || new Date(s).toISOString() !== s)
    throw new Error('Invalid date');
  return s;
}

export function nullableDate(v: unknown) {
  return v === null ? null : date(v);
}

export function fingerprint(v: unknown) {
  const s = str(v, 64);
  if (!/^[a-f0-9]{64}$/.test(s)) throw new Error('Invalid fingerprint');
  return s;
}

export function validateIdentity(v: unknown): LessonIdentity {
  const r = strict(v, [
    'lessonId',
    'transcriptKey',
    'videoId',
    'title',
    'author',
    'source',
    'duration',
    'segmentCount',
  ]);
  if (!['demo', 'youtube', 'vimeo', 'direct', 'upload'].includes(r.source as string))
    throw new Error('Invalid source');
  if (typeof r.author !== 'string' || r.author.length > 300) throw new Error('Invalid author');
  const duration = count(r.duration),
    segmentCount = count(r.segmentCount, true);
  if (duration > 86400 || segmentCount < 1 || segmentCount > 10000)
    throw new Error('Invalid lesson bounds');
  return {
    lessonId: str(r.lessonId, 200),
    transcriptKey: fingerprint(r.transcriptKey),
    ...(r.videoId === undefined ? {} : { videoId: str(r.videoId, 100) }),
    title: str(r.title),
    author: r.author,
    source: r.source as Lesson['source'],
    duration,
    segmentCount,
  };
}

export function validateSection(v: unknown): SectionActivity {
  const r = strict(v, [
    'sectionId',
    'start',
    'end',
    'replays',
    'evidenceReplays',
    'translationReveals',
    'translationHelp',
    'recordingAttempts',
  ]);
  const start = count(r.start),
    end = count(r.end);
  if (end <= start || end > 86400 || typeof r.translationHelp !== 'boolean')
    throw new Error('Invalid section');
  const translationReveals = count(r.translationReveals, true);
  if (translationReveals && !r.translationHelp) throw new Error('Invalid translation signal');
  return {
    sectionId: str(r.sectionId, 200),
    start,
    end,
    replays: count(r.replays, true),
    evidenceReplays: count(r.evidenceReplays, true),
    translationReveals,
    translationHelp: r.translationHelp,
    recordingAttempts: count(r.recordingAttempts, true),
  };
}

export function validateSession(v: unknown): PracticeSession {
  const r = strict(v, [
    'schemaVersion',
    'id',
    'lesson',
    'origin',
    'startedAt',
    'updatedAt',
    'endedAt',
    'completed',
    'completedAt',
    'activeSeconds',
    'activeByDay',
    'lastSectionId',
    'sections',
  ]);
  if (r.schemaVersion !== 1 || !['practice', 'legacy'].includes(r.origin as string))
    throw new Error('Invalid session version');
  const id = str(r.id, 100);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))
    throw new Error('Invalid UUID');
  const lesson = validateIdentity(r.lesson),
    startedAt = nullableDate(r.startedAt),
    updatedAt = date(r.updatedAt),
    endedAt = nullableDate(r.endedAt),
    completedAt = nullableDate(r.completedAt);
  if (typeof r.completed !== 'boolean' || (completedAt && !r.completed))
    throw new Error('Invalid completion');
  if (
    (r.origin === 'practice' && !startedAt) ||
    (startedAt && startedAt > updatedAt) ||
    (endedAt && (endedAt > updatedAt || (startedAt && endedAt < startedAt))) ||
    (completedAt && completedAt > updatedAt)
  )
    throw new Error('Invalid session dates');
  if (!Array.isArray(r.sections) || r.sections.length > lesson.segmentCount)
    throw new Error('Invalid sections');
  const sections = r.sections.map(validateSection);
  if (
    new Set(sections.map((s) => s.sectionId)).size !== sections.length ||
    sections.some((s) => s.end > lesson.duration)
  )
    throw new Error('Invalid section identity');
  const activeByDay: Record<string, number> = {};
  for (const [day, seconds] of Object.entries(obj(r.activeByDay))) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      !Number.isFinite(Date.parse(day)) ||
      new Date(day).toISOString().slice(0, 10) !== day
    )
      throw new Error('Invalid day');
    activeByDay[day] = count(seconds);
  }
  const activeSeconds = count(r.activeSeconds);
  if (
    Math.abs(Object.values(activeByDay).reduce((a, b) => a + b, 0) - activeSeconds) > 0.01 ||
    (r.origin === 'legacy' && activeSeconds !== 0)
  )
    throw new Error('Invalid active time');
  return {
    schemaVersion: 1,
    id,
    lesson,
    origin: r.origin as PracticeSession['origin'],
    startedAt,
    updatedAt,
    endedAt,
    completed: r.completed,
    completedAt,
    activeSeconds,
    activeByDay,
    lastSectionId: r.lastSectionId === null ? null : str(r.lastSectionId, 200),
    sections,
  };
}

export function validateDifficultyReference(v: unknown): DifficultyReference {
  const r = strict(v, [
    'schemaVersion',
    'id',
    'lessonId',
    'transcriptKey',
    'generatedAt',
    'jlptMin',
    'jlptMax',
    'vocabulary',
    'grammar',
    'speechSpeed',
    'conversationalComplexity',
  ]);
  const level = (n: unknown) => {
    if (![1, 2, 3, 4, 5].includes(n as number)) throw new Error('Invalid level');
    return n as 1 | 2 | 3 | 4 | 5;
  };
  const min = JLPT_LEVELS.indexOf(r.jlptMin as (typeof JLPT_LEVELS)[number]),
    max = JLPT_LEVELS.indexOf(r.jlptMax as (typeof JLPT_LEVELS)[number]);
  const lessonId = str(r.lessonId, 200),
    transcriptKey = fingerprint(r.transcriptKey);
  if (
    r.schemaVersion !== 1 ||
    min < 0 ||
    max < min ||
    r.id !== `difficulty:v1:${lessonId}:${transcriptKey}`
  )
    throw new Error('Invalid difficulty identity');
  return {
    schemaVersion: 1,
    id: r.id as string,
    lessonId,
    transcriptKey,
    generatedAt: date(r.generatedAt),
    jlptMin: JLPT_LEVELS[min],
    jlptMax: JLPT_LEVELS[max],
    vocabulary: level(r.vocabulary),
    grammar: level(r.grammar),
    speechSpeed: r.speechSpeed === null ? null : level(r.speechSpeed),
    conversationalComplexity: level(r.conversationalComplexity),
  };
}

export function validateHistory(v: unknown): LearnerHistory {
  const h = emptyHistory();
  try {
    const r = strict(v, [
      'schemaVersion',
      'migrationVersion',
      'sessions',
      'archives',
      'difficulties',
    ]);
    if (r.schemaVersion !== 1 || r.migrationVersion !== 1) return h;
    for (const s of Array.isArray(r.sessions) ? r.sessions : []) {
      try {
        upsertSession(h, validateSession(s));
      } catch {
        /* Isolate damaged records. */
      }
    }
    for (const a of Array.isArray(r.archives) ? r.archives : []) {
      try {
        const raw = strict(a, ['schemaVersion', 'lesson', 'sessionCount', 'activity']),
          lesson = validateIdentity(raw.lesson),
          activity = validateSession(raw.activity),
          sessionCount = count(raw.sessionCount, true);
        if (raw.schemaVersion !== 1 || identityKey(lesson) !== identityKey(activity.lesson))
          continue;
        if (!h.archives.some((a) => identityKey(a.lesson) === identityKey(lesson)))
          h.archives.push({ schemaVersion: 1, lesson, activity, sessionCount });
      } catch {
        /* Keep other archives. */
      }
    }
    for (const d of Array.isArray(r.difficulties) ? r.difficulties : []) {
      try {
        const ref = validateDifficultyReference(d);
        h.difficulties = [...h.difficulties.filter((x) => x.id !== ref.id), ref];
      } catch {
        /* Ignore corrupt estimates. */
      }
    }
  } catch {
    /* Recover safely. */
  }
  return h;
}
