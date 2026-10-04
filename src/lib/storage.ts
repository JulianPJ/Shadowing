// Public facade. Domain implementations live in the adjacent modules.
export {
  progressStorageFailed,
  reportStorageFailure,
  storageKeys,
  readStorage,
  writeStorage,
} from './storage/browser';
export {
  getLiveMedia,
  rememberMedia,
  saveLesson,
  loadLesson,
  recentLessons,
} from './storage/lessons';
export type { StudyRecord } from './storage/lessons';
export {
  loadPreferences,
  loadFavorites,
  TRANSLATION_CACHE_VERSION,
  translationCacheKey,
  loadTranslationCache,
} from './storage/preferences';
export type { Preferences } from './storage/preferences';
export {
  writeLearnerHistory,
  lessonCompleted,
  completeLesson,
  loadQuiz,
  saveQuiz,
  loadDifficulty,
  saveDifficulty,
  loadQuizAttempt,
  saveQuizAttempt,
} from './storage/learning';
