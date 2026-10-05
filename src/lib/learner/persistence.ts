import { readStorage, writeLearnerHistory, reportStorageFailure } from '../storage';
import { emptyHistory, upsertSession, validateHistory, validateSession } from '../learner-progress';
import type { LearnerHistory, PracticeSession } from '../learner-types';
export function loadLearnerHistory(): LearnerHistory {
  return validateHistory(readStorage('learner-history', emptyHistory()));
}

export function savePracticeSession(session: PracticeSession): boolean {
  try {
    const history = loadLearnerHistory();
    upsertSession(history, validateSession(session));
    return writeLearnerHistory(history, session.id);
  } catch {
    reportStorageFailure();
    return false;
  }
}
