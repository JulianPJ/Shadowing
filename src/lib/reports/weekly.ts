import type { LearnerHistory } from '../learner-types';
import type { ReviewEvent } from '../review/history';
import { studyDay, shiftStudyDay } from '../study-day';
export type Goal = { version: 1; minutes: number | null };
export function validateGoal(value: unknown): Goal {
  const raw = value as Partial<Goal> | null;
  return {
    version: 1,
    minutes:
      raw?.version === 1 &&
      typeof raw.minutes === 'number' &&
      Number.isInteger(raw.minutes) &&
      raw.minutes >= 1 &&
      raw.minutes <= 120
        ? raw.minutes
        : null,
  };
}
export type WeeklyReport = {
  from: string;
  to: string;
  activeSeconds: number;
  todaySeconds: number;
  legacyUtcSeconds: number;
  sectionsPractised: number;
  recordingAttempts: number;
  savedTerms: number;
  markedKnown: number;
  reviewAnswers: number;
  reviewRemembered: number;
  reviewRecall: number | null;
  shadowingAttempts: number;
  averageMatch: number | null;
  contentLevels: string[];
};
export type ReportInput = {
  history: LearnerHistory;
  reviews: ReviewEvent[];
  saved: { createdAt: string }[];
  knowledge: { state: string; updatedAt: string }[];
  matches: { attemptedAt: string; score: number }[];
};
/** New samples use local study days. Historical UTC totals are never re-dated. */
export function weeklyReport(input: ReportInput, now: string, timeZone = 'UTC'): WeeklyReport {
  const end = new Date(now);
  if (!Number.isFinite(end.getTime())) throw new Error('Invalid report date');
  const to = studyDay(now, timeZone);
  const from = shiftStudyDay(to, -6);
  const inPeriod = (stamp: string) =>
    Number.isFinite(Date.parse(stamp)) &&
    studyDay(stamp, timeZone) >= from &&
    studyDay(stamp, timeZone) <= to &&
    Date.parse(stamp) <= end.getTime();
  const sessions = [...input.history.sessions, ...input.history.archives.map((a) => a.activity)];
  let activeSeconds = 0,
    todaySeconds = 0,
    legacyUtcSeconds = 0,
    recordingAttempts = 0;
  const sections = new Set<string>();
  const practiced = new Set<string>();
  for (const session of sessions) {
    let periodTime = 0;
    for (const [day, seconds] of Object.entries(session.localActiveByDay ?? session.activeByDay)) {
      if (day >= from && day <= to && Number.isFinite(seconds) && seconds > 0) {
        activeSeconds += seconds;
        periodTime += seconds;
        if (!session.localActiveByDay) legacyUtcSeconds += seconds;
      }
      if (
        day === to &&
        Number.isFinite(seconds) &&
        seconds > 0 &&
        (session.localActiveByDay || timeZone === 'UTC')
      )
        todaySeconds += seconds;
    }
    // Preserve each historical UTC bucket through compaction without inventing
    // a local-date split or dropping it because the archive also spans older days.
    if (session.localActiveByDay)
      for (const [day, seconds] of Object.entries(session.legacyActiveByDay ?? {})) {
        if (day >= from && day <= to && Number.isFinite(seconds) && seconds > 0) {
          activeSeconds += seconds;
          legacyUtcSeconds += seconds;
          periodTime += seconds;
        }
        if (timeZone === 'UTC' && day === to) todaySeconds += seconds;
      }
    if (periodTime > 0) practiced.add(`${session.lesson.lessonId}:${session.lesson.transcriptKey}`);
    // Archives combine dates; section counters in an archive cannot be attributed to a week.
    if (
      input.history.sessions.includes(session) &&
      session.origin === 'practice' &&
      session.startedAt &&
      inPeriod(session.startedAt) &&
      inPeriod(session.updatedAt)
    ) {
      for (const section of session.sections) {
        recordingAttempts += section.recordingAttempts;
        if (section.replays > 0 || section.recordingAttempts > 0)
          sections.add(
            `${session.lesson.lessonId}:${session.lesson.transcriptKey}:${section.sectionId}`,
          );
      }
    }
  }
  const reviews = input.reviews.filter((item) => inPeriod(item.reviewedAt));
  const remembered = reviews.filter(
    (item) => item.grade === 'good' || item.grade === 'easy',
  ).length;
  const matches = input.matches.filter(
    (item) =>
      inPeriod(item.attemptedAt) &&
      Number.isFinite(item.score) &&
      item.score >= 0 &&
      item.score <= 100,
  );
  const levels = input.history.difficulties
    .filter((d) => practiced.has(`${d.lessonId}:${d.transcriptKey}`))
    .map((d) => (d.jlptMin === d.jlptMax ? d.jlptMin : `${d.jlptMin}–${d.jlptMax}`));
  return {
    from,
    to,
    activeSeconds,
    todaySeconds,
    legacyUtcSeconds,
    sectionsPractised: sections.size,
    recordingAttempts,
    savedTerms: input.saved.filter((item) => inPeriod(item.createdAt)).length,
    markedKnown: input.knowledge.filter(
      (item) => item.state === 'known' && inPeriod(item.updatedAt),
    ).length,
    reviewAnswers: reviews.length,
    reviewRemembered: remembered,
    reviewRecall: reviews.length ? Math.round((remembered * 100) / reviews.length) : null,
    shadowingAttempts: matches.length,
    averageMatch: matches.length
      ? Math.round(matches.reduce((total, item) => total + item.score, 0) / matches.length)
      : null,
    contentLevels: [...new Set(levels)].slice(0, 6),
  };
}
