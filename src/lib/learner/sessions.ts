import type { Segment } from '../types';
import type {
  LearnerHistory,
  LessonIdentity,
  PracticeSession,
  SectionActivity,
} from '../learner-types';
import { RESUME_WINDOW_MS, identityKey } from './constants';
export function upsertSession(history: LearnerHistory, session: PracticeSession) {
  const previous = history.sessions.find((s) => s.id === session.id);
  if (previous && identityKey(previous.lesson) !== identityKey(session.lesson))
    throw new Error('Session identity cannot change');
  if (!previous || previous.updatedAt <= session.updatedAt)
    history.sessions = [...history.sessions.filter((s) => s.id !== session.id), session];
}

export function createSession(
  lesson: LessonIdentity,
  now: string,
  id = crypto.randomUUID(),
): PracticeSession {
  return {
    schemaVersion: 1,
    id,
    lesson,
    origin: 'practice',
    startedAt: now,
    updatedAt: now,
    endedAt: null,
    completed: false,
    completedAt: null,
    activeSeconds: 0,
    activeByDay: {},
    lastSectionId: null,
    sections: [],
  };
}

export function resumableSession(
  history: LearnerHistory,
  lesson: LessonIdentity,
  candidateId: string | null,
  now: string,
) {
  return (
    history.sessions.find(
      (s) =>
        s.id === candidateId &&
        s.origin === 'practice' &&
        identityKey(s.lesson) === identityKey(lesson) &&
        Date.parse(now) >= Date.parse(s.updatedAt) &&
        Date.parse(now) - Date.parse(s.updatedAt) < RESUME_WINDOW_MS,
    ) ?? null
  );
}

export function sectionActivity(s: Pick<Segment, 'id' | 'start' | 'end'>): SectionActivity {
  return {
    sectionId: s.id,
    start: s.start,
    end: s.end,
    replays: 0,
    evidenceReplays: 0,
    translationReveals: 0,
    translationHelp: false,
    recordingAttempts: 0,
  };
}

export type PracticeSignal =
  | 'replay'
  | 'evidence-replay'
  | 'translation-reveal'
  | 'recording-attempt'
  | 'navigate'
  | 'bookmark';

export function recordSignal(
  session: PracticeSession,
  segment: Pick<Segment, 'id' | 'start' | 'end'>,
  signal: PracticeSignal,
  now: string,
) {
  const s = session.sections.find((s) => s.sectionId === segment.id) ?? sectionActivity(segment);
  if (!session.sections.includes(s)) session.sections.push(s);
  if (signal === 'replay') s.replays++;
  if (signal === 'evidence-replay') s.evidenceReplays++;
  if (signal === 'translation-reveal') {
    s.translationReveals++;
    s.translationHelp = true;
  }
  if (signal === 'recording-attempt') s.recordingAttempts++;
  session.lastSectionId = segment.id;
  session.updatedAt = now;
  session.endedAt = null;
}
