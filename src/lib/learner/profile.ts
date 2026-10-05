import type { QuizAttempt } from '../types';
import type {
  AttentionSection,
  BookmarkSnapshot,
  DifficultyReference,
  LearnerHistory,
  LearnerProfile,
  LessonIdentity,
  SectionActivity,
} from '../learner-types';
import { ATTENTION_WEIGHTS, JLPT_LEVELS, identityKey } from './constants';
import { sectionActivity } from './sessions';
export const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function contentSummary(lessons: LessonProgressInput[]) {
  // Most recently practised revision per lesson, one vote per unique lesson.
  const seen = new Set<string>();
  const analyzed = [...lessons]
    .sort(
      (a, b) =>
        b.lastPractisedAt.localeCompare(a.lastPractisedAt) ||
        identityKey(a.lesson).localeCompare(identityKey(b.lesson)),
    )
    .filter((l) => {
      if (!l.practised || seen.has(l.lesson.lessonId)) return false;
      seen.add(l.lesson.lessonId);
      return !!l.difficulty;
    })
    .slice(0, 20);
  const typicalContent =
    analyzed.length < 5
      ? null
      : {
          min: JLPT_LEVELS[
            Math.round(median(analyzed.map((l) => JLPT_LEVELS.indexOf(l.difficulty!.jlptMin))))
          ],
          max: JLPT_LEVELS[
            Math.round(median(analyzed.map((l) => JLPT_LEVELS.indexOf(l.difficulty!.jlptMax))))
          ],
          lessons: analyzed.length,
        };
  let contentTrend: LearnerProfile['contentTrend'] = null;
  if (analyzed.length >= 10) {
    const midpoint = (l: LessonProgressInput) =>
      (JLPT_LEVELS.indexOf(l.difficulty!.jlptMin) + JLPT_LEVELS.indexOf(l.difficulty!.jlptMax)) / 2;
    const delta =
      median(analyzed.slice(0, 5).map(midpoint)) - median(analyzed.slice(5, 10).map(midpoint));
    contentTrend = delta >= 0.5 ? 'harder' : delta <= -0.5 ? 'easier' : 'similar';
  }
  return { typicalContent, contentTrend };
}

export type LessonProgressInput = LearnerProfile['lessons'][number];

export function aggregateProfile(
  history: LearnerHistory,
  attempts: QuizAttempt[],
  bookmarks: BookmarkSnapshot[],
  now: string,
): LearnerProfile {
  const difficultyByLesson = new Map<string, DifficultyReference>();
  for (const difficulty of history.difficulties) {
    const key = identityKey(difficulty);
    if (!difficultyByLesson.has(key)) difficultyByLesson.set(key, difficulty);
  }
  const recentDay = new Date(Date.parse(now) - 29 * 86400000).toISOString().slice(0, 10),
    today = now.slice(0, 10);
  const lessonMap = new Map<string, LessonProgressInput>(),
    sectionMap = new Map<string, AttentionSection>();
  const getLesson = (lesson: LessonIdentity, updatedAt: string): LessonProgressInput => {
    const key = identityKey(lesson),
      existing = lessonMap.get(key);
    if (existing) {
      if (updatedAt > existing.lastPractisedAt) {
        existing.lastPractisedAt = updatedAt;
        existing.lesson = lesson;
      }
      return existing;
    }
    const l = {
      lesson,
      lastPractisedAt: updatedAt,
      completed: false,
      practised: false,
      activeSeconds: 0,
      sessions: 0,
      lastSectionId: null,
      difficulty: difficultyByLesson.get(key) ?? null,
      quizAttempts: 0,
      quizCompleted: 0,
    };
    lessonMap.set(key, l);
    return l;
  };
  const getSection = (lesson: LessonIdentity, s: SectionActivity) => {
    const key = JSON.stringify([identityKey(lesson), s.sectionId]);
    if (!sectionMap.has(key))
      sectionMap.set(key, {
        ...sectionActivity({ id: s.sectionId, start: s.start, end: s.end }),
        lesson,
        bookmarked: false,
        missedQuestions: 0,
        reasons: [],
        rank: 0,
      });
    return sectionMap.get(key)!;
  };
  let activeSeconds = 0,
    recentActiveSeconds = 0,
    sessionCount = 0;
  const records = [
    ...history.sessions.map((s) => ({ s, count: s.origin === 'practice' ? 1 : 0 })),
    ...history.archives.map((a) => ({ s: a.activity, count: a.sessionCount })),
  ];
  for (const { s, count } of records) {
    const l = getLesson(s.lesson, s.updatedAt);
    l.practised ||=
      s.activeSeconds > 0 ||
      s.completed ||
      s.sections.some((x) => x.replays || x.translationReveals || x.recordingAttempts);
    l.completed ||= s.completed;
    l.activeSeconds += s.activeSeconds;
    l.sessions += count;
    if (s.updatedAt === l.lastPractisedAt) l.lastSectionId = s.lastSectionId;
    activeSeconds += s.activeSeconds;
    sessionCount += count;
    recentActiveSeconds += Object.entries(s.activeByDay).reduce(
      (n, [day, seconds]) => n + (day >= recentDay && day <= today ? seconds : 0),
      0,
    );
    for (const sSection of s.sections) {
      const section = getSection(s.lesson, sSection);
      section.replays += sSection.replays;
      section.evidenceReplays += sSection.evidenceReplays;
      section.translationReveals += sSection.translationReveals;
      section.translationHelp ||= sSection.translationHelp;
      section.recordingAttempts += sSection.recordingAttempts;
    }
  }
  const uniqueAttempts = [
    ...new Map(
      [...attempts].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).map((a) => [a.id, a]),
    ).values(),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  for (const a of uniqueAttempts) {
    const l = lessonMap.get(identityKey({ lessonId: a.lessonId, transcriptKey: a.transcriptKey }));
    if (l) {
      l.quizAttempts++;
      if (a.completedAt) l.quizCompleted++;
      for (const r of a.results.filter((r) => !r.correct))
        for (const sectionId of new Set(r.evidence.segmentIds)) {
          const existing = sectionMap.get(JSON.stringify([identityKey(l.lesson), sectionId]));
          const section =
            existing ??
            getSection(
              l.lesson,
              sectionActivity({ id: sectionId, start: r.evidence.start, end: r.evidence.end }),
            );
          section.missedQuestions++;
        }
    }
  }
  for (const b of bookmarks)
    for (const s of b.sections)
      getSection(
        b.lesson,
        sectionActivity({ id: s.sectionId, start: s.start, end: s.end }),
      ).bookmarked = true;
  const sections = [...sectionMap.values()];
  for (const s of sections) {
    if (s.replays) s.reasons.push(`${s.replays} replay${s.replays === 1 ? '' : 's'}`);
    if (s.translationHelp)
      s.reasons.push(
        s.translationReveals
          ? `${s.translationReveals} translation reveal${s.translationReveals === 1 ? '' : 's'}`
          : 'Translation help previously used',
      );
    if (s.bookmarked) s.reasons.push('Saved section');
    if (s.missedQuestions)
      s.reasons.push(`${s.missedQuestions} missed question${s.missedQuestions === 1 ? '' : 's'}`);
    if (s.recordingAttempts > 1) s.reasons.push(`${s.recordingAttempts} recording attempts`);
    s.rank =
      s.replays * ATTENTION_WEIGHTS.replay +
      Number(s.translationHelp) * ATTENTION_WEIGHTS.translation +
      Number(s.bookmarked) * ATTENTION_WEIGHTS.bookmark +
      s.missedQuestions * ATTENTION_WEIGHTS.missedQuestion +
      Math.max(0, s.recordingAttempts - 1) * ATTENTION_WEIGHTS.repeatedRecording;
  }
  const lessons = [...lessonMap.values()].sort(
    (a, b) =>
      b.lastPractisedAt.localeCompare(a.lastPractisedAt) ||
      identityKey(a.lesson).localeCompare(identityKey(b.lesson)),
  );
  const completedAttempts = uniqueAttempts.filter((a) => a.completedAt);
  const recentAttempts = completedAttempts.filter(
    (a) => a.completedAt!.slice(0, 10) >= recentDay && a.completedAt!.slice(0, 10) <= today,
  );
  const correct = (list: QuizAttempt[]) => list.reduce((n, a) => n + a.score, 0),
    total = (list: QuizAttempt[]) => list.reduce((n, a) => n + a.totalQuestions, 0);
  return {
    schemaVersion: 1,
    distinctLessons: new Set(lessons.filter((l) => l.practised).map((l) => l.lesson.lessonId)).size,
    completedLessons: new Set(lessons.filter((l) => l.completed).map((l) => l.lesson.lessonId))
      .size,
    sessionCount,
    activeSeconds,
    recentActiveSeconds,
    replays: sections.reduce((n, s) => n + s.replays, 0),
    evidenceReplays: sections.reduce((n, s) => n + s.evidenceReplays, 0),
    translationReveals: sections.reduce((n, s) => n + s.translationReveals, 0),
    translationSections: sections.filter((s) => s.translationHelp).length,
    recordingAttempts: sections.reduce((n, s) => n + s.recordingAttempts, 0),
    bookmarks: sections.filter((s) => s.bookmarked).length,
    comprehension: {
      attempts: uniqueAttempts.length,
      completed: completedAttempts.length,
      correct: correct(completedAttempts),
      total: total(completedAttempts),
      recentCorrect: correct(recentAttempts),
      recentTotal: total(recentAttempts),
      missedQuestions: uniqueAttempts.reduce(
        (n, a) => n + a.results.filter((r) => !r.correct).length,
        0,
      ),
      history: uniqueAttempts,
    },
    ...contentSummary(lessons),
    lessons,
    attention: sections
      .filter((s) => s.rank > 0)
      .sort(
        (a, b) =>
          b.rank - a.rank ||
          identityKey(a.lesson).localeCompare(identityKey(b.lesson)) ||
          a.start - b.start ||
          a.sectionId.localeCompare(b.sectionId),
      ),
  };
}
