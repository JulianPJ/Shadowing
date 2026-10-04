import type { LearnerHistory, PracticeSession } from '../learner-types';
import { DETAIL_SESSION_LIMIT, identityKey } from './constants';

export function mergeActivity(target: PracticeSession, s: PracticeSession) {
  if (s.origin === 'practice' && target.origin === 'legacy') {
    target.origin = 'practice';
    target.startedAt = s.startedAt;
  }
  if (s.startedAt && target.startedAt && s.startedAt < target.startedAt)
    target.startedAt = s.startedAt;
  target.activeSeconds += s.activeSeconds;
  target.completed ||= s.completed;
  for (const [day, seconds] of Object.entries(s.activeByDay))
    target.activeByDay[day] = (target.activeByDay[day] ?? 0) + seconds;
  if (s.completedAt && (!target.completedAt || s.completedAt > target.completedAt))
    target.completedAt = s.completedAt;
  if (s.updatedAt > target.updatedAt) {
    target.updatedAt = s.updatedAt;
    target.lastSectionId = s.lastSectionId;
    target.endedAt = s.endedAt;
  }
  for (const section of s.sections) {
    const found = target.sections.find((x) => x.sectionId === section.sectionId);
    if (!found) target.sections.push({ ...section });
    else {
      found.replays += section.replays;
      found.evidenceReplays += section.evidenceReplays;
      found.translationReveals += section.translationReveals;
      found.recordingAttempts += section.recordingAttempts;
      found.translationHelp ||= section.translationHelp;
    }
  }
}

// Compaction happens before one atomic envelope write, so retry cannot double-count.
export function compactHistory(history: LearnerHistory, protectedId?: string): LearnerHistory {
  const h: LearnerHistory = structuredClone(history);
  h.sessions.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id));
  while (h.sessions.length > DETAIL_SESSION_LIMIT) {
    const index = h.sessions.findIndex((s) => s.id !== protectedId),
      s = h.sessions.splice(index, 1)[0];
    const archive = h.archives.find((a) => identityKey(a.lesson) === identityKey(s.lesson));
    if (archive) {
      mergeActivity(archive.activity, s);
      archive.sessionCount += s.origin === 'practice' ? 1 : 0;
    } else
      h.archives.push({
        schemaVersion: 1,
        lesson: s.lesson,
        sessionCount: s.origin === 'practice' ? 1 : 0,
        activity: s,
      });
  }
  return h;
}
