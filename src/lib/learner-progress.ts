import type { ContentDifficultyAnalysis, Lesson, QuizAttempt, Segment } from './types';
import type { AttentionSection, BookmarkSnapshot, DifficultyReference, LearnerHistory, LearnerProfile, LessonIdentity, PracticeSession, SectionActivity } from './learner-types';

export const RESUME_WINDOW_MS = 30 * 60 * 1000;
export const CHECKPOINT_MS = 15000;
export const INTERACTION_WINDOW_MS = 30000;
export const DETAIL_SESSION_LIMIT = 500;
export const ARCHIVE_LIMIT = 2000;
export const HISTORY_BYTE_LIMIT = 2_000_000;
export const ATTENTION_WEIGHTS = { replay: 1, translation: 2, bookmark: 2, missedQuestion: 3, repeatedRecording: 1 };
export const JLPT_LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'] as const;
export const identityKey = (lesson: Pick<LessonIdentity, 'lessonId' | 'transcriptKey'>) => JSON.stringify([lesson.lessonId, lesson.transcriptKey]);
export const emptyHistory = (): LearnerHistory => ({ schemaVersion: 1, migrationVersion: 1, sessions: [], archives: [], difficulties: [] });
export function lessonIdentity(lesson: Lesson, transcriptKey: string): LessonIdentity {
  return { lessonId: lesson.id, transcriptKey, ...(lesson.videoId ? { videoId: lesson.videoId } : {}), title: lesson.title.slice(0, 500), author: lesson.author.slice(0, 300), source: lesson.source, duration: lesson.segments.at(-1)?.end ?? 0, segmentCount: lesson.segments.length };
}
export function compactDifficulty(a: ContentDifficultyAnalysis): DifficultyReference {
  return { schemaVersion: 1, id: a.id, lessonId: a.lessonId, transcriptKey: a.transcriptKey, generatedAt: a.generatedAt, jlptMin: a.overall.jlptMin, jlptMax: a.overall.jlptMax, vocabulary: a.vocabulary.level, grammar: a.grammar.level, speechSpeed: a.speechSpeed.level, conversationalComplexity: a.conversationalComplexity.level };
}
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid learner record');
  return v as Record<string, unknown>;
};
function strict(v: unknown, fields: string[]) {
  const r = obj(v);
  if (Object.keys(r).some(k => !fields.includes(k))) throw new Error('Unexpected learner fields');
  return r;
}
function str(v: unknown, max = 500): string { if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error('Invalid string'); return v; }
function count(v: unknown, integer = false): number { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (integer && !Number.isSafeInteger(v))) throw new Error('Invalid number'); return v; }
function date(v: unknown): string { const s = str(v, 24); if (!Number.isFinite(Date.parse(s)) || new Date(s).toISOString() !== s) throw new Error('Invalid date'); return s; }
function nullableDate(v: unknown) { return v === null ? null : date(v); }
function fingerprint(v: unknown) { const s = str(v, 64); if (!/^[a-f0-9]{64}$/.test(s)) throw new Error('Invalid fingerprint'); return s; }
export function validateIdentity(v: unknown): LessonIdentity {
  const r = strict(v, ['lessonId', 'transcriptKey', 'videoId', 'title', 'author', 'source', 'duration', 'segmentCount']);
  if (!['demo', 'youtube', 'upload'].includes(r.source as string)) throw new Error('Invalid source');
  if (typeof r.author !== 'string' || r.author.length > 300) throw new Error('Invalid author');
  const duration = count(r.duration), segmentCount = count(r.segmentCount, true);
  if (duration > 86400 || segmentCount < 1 || segmentCount > 10000) throw new Error('Invalid lesson bounds');
  return { lessonId: str(r.lessonId, 200), transcriptKey: fingerprint(r.transcriptKey), ...(r.videoId === undefined ? {} : { videoId: str(r.videoId, 100) }), title: str(r.title), author: r.author, source: r.source as Lesson['source'], duration, segmentCount };
}
export function validateSection(v: unknown): SectionActivity {
  const r = strict(v, ['sectionId', 'start', 'end', 'replays', 'evidenceReplays', 'translationReveals', 'translationHelp', 'recordingAttempts']);
  const start = count(r.start), end = count(r.end);
  if (end <= start || end > 86400 || typeof r.translationHelp !== 'boolean') throw new Error('Invalid section');
  const translationReveals = count(r.translationReveals, true);
  if (translationReveals && !r.translationHelp) throw new Error('Invalid translation signal');
  return { sectionId: str(r.sectionId, 200), start, end, replays: count(r.replays, true), evidenceReplays: count(r.evidenceReplays, true), translationReveals, translationHelp: r.translationHelp, recordingAttempts: count(r.recordingAttempts, true) };
}
export function validateSession(v: unknown): PracticeSession {
  const r = strict(v, ['schemaVersion', 'id', 'lesson', 'origin', 'startedAt', 'updatedAt', 'endedAt', 'completed', 'completedAt', 'activeSeconds', 'activeByDay', 'lastSectionId', 'sections']);
  if (r.schemaVersion !== 1 || !['practice', 'legacy'].includes(r.origin as string)) throw new Error('Invalid session version');
  const id = str(r.id, 100);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw new Error('Invalid UUID');
  const lesson = validateIdentity(r.lesson), startedAt = nullableDate(r.startedAt), updatedAt = date(r.updatedAt), endedAt = nullableDate(r.endedAt), completedAt = nullableDate(r.completedAt);
  if (typeof r.completed !== 'boolean' || (completedAt && !r.completed)) throw new Error('Invalid completion');
  if ((r.origin === 'practice' && !startedAt) || (startedAt && startedAt > updatedAt) || (endedAt && (endedAt > updatedAt || (startedAt && endedAt < startedAt))) || (completedAt && completedAt > updatedAt)) throw new Error('Invalid session dates');
  if (!Array.isArray(r.sections) || r.sections.length > lesson.segmentCount) throw new Error('Invalid sections');
  const sections = r.sections.map(validateSection);
  if (new Set(sections.map(s => s.sectionId)).size !== sections.length || sections.some(s => s.end > lesson.duration)) throw new Error('Invalid section identity');
  const activeByDay: Record<string, number> = {};
  for (const [day, seconds] of Object.entries(obj(r.activeByDay))) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) throw new Error('Invalid day');
    activeByDay[day] = count(seconds);
  }
  const activeSeconds = count(r.activeSeconds);
  if (Math.abs(Object.values(activeByDay).reduce((a, b) => a + b, 0) - activeSeconds) > 0.01 || (r.origin === 'legacy' && activeSeconds !== 0)) throw new Error('Invalid active time');
  return { schemaVersion: 1, id, lesson, origin: r.origin as PracticeSession['origin'], startedAt, updatedAt, endedAt, completed: r.completed, completedAt, activeSeconds, activeByDay, lastSectionId: r.lastSectionId === null ? null : str(r.lastSectionId, 200), sections };
}
export function validateDifficultyReference(v: unknown): DifficultyReference {
  const r = strict(v, ['schemaVersion', 'id', 'lessonId', 'transcriptKey', 'generatedAt', 'jlptMin', 'jlptMax', 'vocabulary', 'grammar', 'speechSpeed', 'conversationalComplexity']);
  const level = (n: unknown) => { if (![1, 2, 3, 4, 5].includes(n as number)) throw new Error('Invalid level'); return n as 1 | 2 | 3 | 4 | 5; };
  const min = JLPT_LEVELS.indexOf(r.jlptMin as typeof JLPT_LEVELS[number]), max = JLPT_LEVELS.indexOf(r.jlptMax as typeof JLPT_LEVELS[number]);
  const lessonId = str(r.lessonId, 200), transcriptKey = fingerprint(r.transcriptKey);
  if (r.schemaVersion !== 1 || min < 0 || max < min || r.id !== `difficulty:v1:${lessonId}:${transcriptKey}`) throw new Error('Invalid difficulty identity');
  return { schemaVersion: 1, id: r.id as string, lessonId, transcriptKey, generatedAt: date(r.generatedAt), jlptMin: JLPT_LEVELS[min], jlptMax: JLPT_LEVELS[max], vocabulary: level(r.vocabulary), grammar: level(r.grammar), speechSpeed: r.speechSpeed === null ? null : level(r.speechSpeed), conversationalComplexity: level(r.conversationalComplexity) };
}
export function validateHistory(v: unknown): LearnerHistory {
  const h = emptyHistory();
  try {
    const r = strict(v, ['schemaVersion', 'migrationVersion', 'sessions', 'archives', 'difficulties']);
    if (r.schemaVersion !== 1 || r.migrationVersion !== 1) return h;
    for (const s of Array.isArray(r.sessions) ? r.sessions : []) { try { upsertSession(h, validateSession(s)); } catch { /* Isolate damaged records. */ } }
    for (const a of Array.isArray(r.archives) ? r.archives : []) {
      try {
        const raw = strict(a, ['schemaVersion', 'lesson', 'sessionCount', 'activity']), lesson = validateIdentity(raw.lesson), activity = validateSession(raw.activity), sessionCount = count(raw.sessionCount, true);
        if (raw.schemaVersion !== 1 || identityKey(lesson) !== identityKey(activity.lesson)) continue;
        if (!h.archives.some(a => identityKey(a.lesson) === identityKey(lesson))) h.archives.push({ schemaVersion: 1, lesson, activity, sessionCount });
      } catch { /* Keep other archives. */ }
    }
    for (const d of Array.isArray(r.difficulties) ? r.difficulties : []) { try { const ref = validateDifficultyReference(d); h.difficulties = [...h.difficulties.filter(x => x.id !== ref.id), ref]; } catch { /* Ignore corrupt estimates. */ } }
  } catch { /* Recover safely. */ }
  return h;
}
export function upsertSession(history: LearnerHistory, session: PracticeSession) {
  const previous = history.sessions.find(s => s.id === session.id);
  if (previous && identityKey(previous.lesson) !== identityKey(session.lesson)) throw new Error('Session identity cannot change');
  if (!previous || previous.updatedAt <= session.updatedAt) history.sessions = [...history.sessions.filter(s => s.id !== session.id), session];
}
export function createSession(lesson: LessonIdentity, now: string, id = crypto.randomUUID()): PracticeSession {
  return { schemaVersion: 1, id, lesson, origin: 'practice', startedAt: now, updatedAt: now, endedAt: null, completed: false, completedAt: null, activeSeconds: 0, activeByDay: {}, lastSectionId: null, sections: [] };
}
export function resumableSession(history: LearnerHistory, lesson: LessonIdentity, candidateId: string | null, now: string) {
  return history.sessions.find(s => s.id === candidateId && s.origin === 'practice' && identityKey(s.lesson) === identityKey(lesson) && Date.parse(now) >= Date.parse(s.updatedAt) && Date.parse(now) - Date.parse(s.updatedAt) < RESUME_WINDOW_MS) ?? null;
}
export function sectionActivity(s: Pick<Segment, 'id' | 'start' | 'end'>): SectionActivity { return { sectionId: s.id, start: s.start, end: s.end, replays: 0, evidenceReplays: 0, translationReveals: 0, translationHelp: false, recordingAttempts: 0 }; }
export type PracticeSignal = 'replay' | 'evidence-replay' | 'translation-reveal' | 'recording-attempt' | 'navigate' | 'bookmark';
export function recordSignal(session: PracticeSession, segment: Pick<Segment, 'id' | 'start' | 'end'>, signal: PracticeSignal, now: string) {
  const s = session.sections.find(s => s.sectionId === segment.id) ?? sectionActivity(segment);
  if (!session.sections.includes(s)) session.sections.push(s);
  if (signal === 'replay') s.replays++;
  if (signal === 'evidence-replay') s.evidenceReplays++;
  if (signal === 'translation-reveal') { s.translationReveals++; s.translationHelp = true; }
  if (signal === 'recording-attempt') s.recordingAttempts++;
  session.lastSectionId = segment.id; session.updatedAt = now; session.endedAt = null;
}
function mergeActivity(target: PracticeSession, s: PracticeSession) {
  if (s.origin === 'practice' && target.origin === 'legacy') { target.origin = 'practice'; target.startedAt = s.startedAt; }
  if (s.startedAt && target.startedAt && s.startedAt < target.startedAt) target.startedAt = s.startedAt;
  target.activeSeconds += s.activeSeconds;
  target.completed ||= s.completed;
  for (const [day, seconds] of Object.entries(s.activeByDay)) target.activeByDay[day] = (target.activeByDay[day] ?? 0) + seconds;
  if (s.completedAt && (!target.completedAt || s.completedAt > target.completedAt)) target.completedAt = s.completedAt;
  if (s.updatedAt > target.updatedAt) { target.updatedAt = s.updatedAt; target.lastSectionId = s.lastSectionId; target.endedAt = s.endedAt; }
  for (const section of s.sections) {
    const found = target.sections.find(x => x.sectionId === section.sectionId);
    if (!found) target.sections.push({ ...section });
    else { found.replays += section.replays; found.evidenceReplays += section.evidenceReplays; found.translationReveals += section.translationReveals; found.recordingAttempts += section.recordingAttempts; found.translationHelp ||= section.translationHelp; }
  }
}
// Compaction happens before one atomic envelope write, so retry cannot double-count.
export function compactHistory(history: LearnerHistory, protectedId?: string): LearnerHistory {
  const h: LearnerHistory = structuredClone(history);
  h.sessions.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id));
  while (h.sessions.length > DETAIL_SESSION_LIMIT) {
    const index = h.sessions.findIndex(s => s.id !== protectedId), s = h.sessions.splice(index, 1)[0];
    const archive = h.archives.find(a => identityKey(a.lesson) === identityKey(s.lesson));
    if (archive) { mergeActivity(archive.activity, s); archive.sessionCount += s.origin === 'practice' ? 1 : 0; }
    else h.archives.push({ schemaVersion: 1, lesson: s.lesson, sessionCount: s.origin === 'practice' ? 1 : 0, activity: s });
  }
  return h;
}
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
export function contentSummary(lessons: LessonProgressInput[]) {
  // Most recently practised revision per lesson, one vote per unique lesson.
  const seen = new Set<string>();
  const analyzed = [...lessons].sort((a, b) => b.lastPractisedAt.localeCompare(a.lastPractisedAt) || identityKey(a.lesson).localeCompare(identityKey(b.lesson))).filter(l => { if (!l.practised || seen.has(l.lesson.lessonId)) return false; seen.add(l.lesson.lessonId); return !!l.difficulty; }).slice(0, 20);
  const typicalContent = analyzed.length < 5 ? null : { min: JLPT_LEVELS[Math.round(median(analyzed.map(l => JLPT_LEVELS.indexOf(l.difficulty!.jlptMin))))], max: JLPT_LEVELS[Math.round(median(analyzed.map(l => JLPT_LEVELS.indexOf(l.difficulty!.jlptMax))))], lessons: analyzed.length };
  let contentTrend: LearnerProfile['contentTrend'] = null;
  if (analyzed.length >= 10) {
    const midpoint = (l: LessonProgressInput) => (JLPT_LEVELS.indexOf(l.difficulty!.jlptMin) + JLPT_LEVELS.indexOf(l.difficulty!.jlptMax)) / 2;
    const delta = median(analyzed.slice(0, 5).map(midpoint)) - median(analyzed.slice(5, 10).map(midpoint));
    contentTrend = delta >= 0.5 ? 'harder' : delta <= -0.5 ? 'easier' : 'similar';
  }
  return { typicalContent, contentTrend };
}
type LessonProgressInput = LearnerProfile['lessons'][number];
export function aggregateProfile(history: LearnerHistory, attempts: QuizAttempt[], bookmarks: BookmarkSnapshot[], now: string): LearnerProfile {
  const recentDay = new Date(Date.parse(now) - 29 * 86400000).toISOString().slice(0, 10), today = now.slice(0, 10);
  const lessonMap = new Map<string, LessonProgressInput>(), sectionMap = new Map<string, AttentionSection>();
  const getLesson = (lesson: LessonIdentity, updatedAt: string): LessonProgressInput => {
    const key = identityKey(lesson), existing = lessonMap.get(key);
    if (existing) { if (updatedAt > existing.lastPractisedAt) { existing.lastPractisedAt = updatedAt; existing.lesson = lesson; } return existing; }
    const l = { lesson, lastPractisedAt: updatedAt, completed: false, practised: false, activeSeconds: 0, sessions: 0, lastSectionId: null, difficulty: history.difficulties.find(d => d.lessonId === lesson.lessonId && d.transcriptKey === lesson.transcriptKey) ?? null, quizAttempts: 0, quizCompleted: 0 };
    lessonMap.set(key, l); return l;
  };
  const getSection = (lesson: LessonIdentity, s: SectionActivity) => {
    const key = JSON.stringify([identityKey(lesson), s.sectionId]);
    if (!sectionMap.has(key)) sectionMap.set(key, { ...sectionActivity({ id: s.sectionId, start: s.start, end: s.end }), lesson, bookmarked: false, missedQuestions: 0, reasons: [], rank: 0 });
    return sectionMap.get(key)!;
  };
  let activeSeconds = 0, recentActiveSeconds = 0, sessionCount = 0;
  const records = [...history.sessions.map(s => ({ s, count: s.origin === 'practice' ? 1 : 0 })), ...history.archives.map(a => ({ s: a.activity, count: a.sessionCount }))];
  for (const { s, count } of records) {
    const l = getLesson(s.lesson, s.updatedAt);
    l.practised ||= s.activeSeconds > 0 || s.completed || s.sections.some(x => x.replays || x.translationReveals || x.recordingAttempts);
    l.completed ||= s.completed; l.activeSeconds += s.activeSeconds; l.sessions += count;
    if (s.updatedAt === l.lastPractisedAt) l.lastSectionId = s.lastSectionId;
    activeSeconds += s.activeSeconds; sessionCount += count;
    recentActiveSeconds += Object.entries(s.activeByDay).reduce((n, [day, seconds]) => n + (day >= recentDay && day <= today ? seconds : 0), 0);
    for (const sSection of s.sections) {
      const section = getSection(s.lesson, sSection);
      section.replays += sSection.replays; section.evidenceReplays += sSection.evidenceReplays; section.translationReveals += sSection.translationReveals; section.translationHelp ||= sSection.translationHelp; section.recordingAttempts += sSection.recordingAttempts;
    }
  }
  const uniqueAttempts = [...new Map([...attempts].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).map(a => [a.id, a])).values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  for (const a of uniqueAttempts) {
    const l = lessonMap.get(identityKey({ lessonId: a.lessonId, transcriptKey: a.transcriptKey }));
    if (l) {
      l.quizAttempts++; if (a.completedAt) l.quizCompleted++;
      for (const r of a.results.filter(r => !r.correct)) for (const sectionId of new Set(r.evidence.segmentIds)) {
        const existing = sectionMap.get(JSON.stringify([identityKey(l.lesson), sectionId]));
        const section = existing ?? getSection(l.lesson, sectionActivity({ id: sectionId, start: r.evidence.start, end: r.evidence.end }));
        section.missedQuestions++;
      }
    }
  }
  for (const b of bookmarks) for (const s of b.sections) getSection(b.lesson, sectionActivity({ id: s.sectionId, start: s.start, end: s.end })).bookmarked = true;
  const sections = [...sectionMap.values()];
  for (const s of sections) {
    if (s.replays) s.reasons.push(`${s.replays} replay${s.replays === 1 ? '' : 's'}`);
    if (s.translationHelp) s.reasons.push(s.translationReveals ? `${s.translationReveals} translation reveal${s.translationReveals === 1 ? '' : 's'}` : 'Translation help previously used');
    if (s.bookmarked) s.reasons.push('Saved section');
    if (s.missedQuestions) s.reasons.push(`${s.missedQuestions} missed question${s.missedQuestions === 1 ? '' : 's'}`);
    if (s.recordingAttempts > 1) s.reasons.push(`${s.recordingAttempts} recording attempts`);
    s.rank = s.replays * ATTENTION_WEIGHTS.replay + Number(s.translationHelp) * ATTENTION_WEIGHTS.translation + Number(s.bookmarked) * ATTENTION_WEIGHTS.bookmark + s.missedQuestions * ATTENTION_WEIGHTS.missedQuestion + Math.max(0, s.recordingAttempts - 1) * ATTENTION_WEIGHTS.repeatedRecording;
  }
  const lessons = [...lessonMap.values()].sort((a, b) => b.lastPractisedAt.localeCompare(a.lastPractisedAt) || identityKey(a.lesson).localeCompare(identityKey(b.lesson)));
  const completedAttempts = uniqueAttempts.filter(a => a.completedAt);
  const recentAttempts = completedAttempts.filter(a => a.completedAt!.slice(0, 10) >= recentDay && a.completedAt!.slice(0, 10) <= today);
  const correct = (list: QuizAttempt[]) => list.reduce((n, a) => n + a.score, 0), total = (list: QuizAttempt[]) => list.reduce((n, a) => n + a.totalQuestions, 0);
  return { schemaVersion: 1, distinctLessons: new Set(lessons.filter(l => l.practised).map(l => l.lesson.lessonId)).size, completedLessons: new Set(lessons.filter(l => l.completed).map(l => l.lesson.lessonId)).size, sessionCount, activeSeconds, recentActiveSeconds,
    replays: sections.reduce((n, s) => n + s.replays, 0), evidenceReplays: sections.reduce((n, s) => n + s.evidenceReplays, 0), translationReveals: sections.reduce((n, s) => n + s.translationReveals, 0), translationSections: sections.filter(s => s.translationHelp).length, recordingAttempts: sections.reduce((n, s) => n + s.recordingAttempts, 0), bookmarks: sections.filter(s => s.bookmarked).length,
    comprehension: { attempts: uniqueAttempts.length, completed: completedAttempts.length, correct: correct(completedAttempts), total: total(completedAttempts), recentCorrect: correct(recentAttempts), recentTotal: total(recentAttempts), missedQuestions: uniqueAttempts.reduce((n, a) => n + a.results.filter(r => !r.correct).length, 0), history: uniqueAttempts }, ...contentSummary(lessons), lessons,
    attention: sections.filter(s => s.rank > 0).sort((a, b) => b.rank - a.rank || identityKey(a.lesson).localeCompare(identityKey(b.lesson)) || a.start - b.start || a.sectionId.localeCompare(b.sectionId)) };
}
