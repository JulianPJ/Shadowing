import { readStorage, reportStorageFailure } from '../storage/browser';
import { writeLearnerHistory } from '../storage/learning';
import { emptyHistory } from './constants';
import { upsertSession } from './sessions';
import { validateHistory, validateSession } from './validation';
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
