// Public facade. Domain implementations live in the adjacent modules.
export { QuizValidationError, object } from './transcript-validation';
export { validateQuizLesson, transcriptRevision, transcriptKey } from './transcript';
export {
  QUESTION_KINDS,
  mapEvidence,
  validateQuestions,
  filterGeneratedQuestions,
} from './quiz/questions';
export { createQuiz, createGeneratedQuiz, validateQuiz } from './quiz/document';
export { scoreQuiz, newAttempt, updateAttempt, validateAttempt } from './quiz/attempts';
