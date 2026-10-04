// Public facade. Domain implementations live in the adjacent modules.
export {
  RESUME_WINDOW_MS,
  CHECKPOINT_MS,
  INTERACTION_WINDOW_MS,
  DETAIL_SESSION_LIMIT,
  ARCHIVE_LIMIT,
  HISTORY_BYTE_LIMIT,
  ATTENTION_WEIGHTS,
  JLPT_LEVELS,
  identityKey,
  emptyHistory,
  lessonIdentity,
  compactDifficulty,
} from './learner/constants';
export {
  validateIdentity,
  validateSection,
  validateSession,
  validateDifficultyReference,
  validateHistory,
} from './learner/validation';
export {
  upsertSession,
  createSession,
  resumableSession,
  sectionActivity,
  recordSignal,
} from './learner/sessions';
export type { PracticeSignal } from './learner/sessions';
export { compactHistory } from './learner/retention';
export { contentSummary, aggregateProfile } from './learner/profile';
