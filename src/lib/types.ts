export type Cue = { start: number; end: number; text: string; translation?: string; estimated?: boolean };
export type Segment = { id: string; start: number; end: number; japanese: string; translation?: string; estimated?: boolean };
export type Lesson = {
  id: string; title: string; author: string; source: 'demo' | 'youtube' | 'upload';
  videoId?: string; mediaUrl?: string; mediaName?: string; segments: Segment[];
  transcriptSource: string; notice?: string;
};
export type Mode = 'shadowing' | 'continuous';
export type PlaybackState = 'ready' | 'listening' | 'paused' | 'your-turn' | 'complete';
export interface TranscriptionProvider<Input = string> {
  name: string;
  transcribe(input: Input, signal?: AbortSignal): Promise<{ cues: Cue[]; title?: string; author?: string; provider?: string }>;
}
export interface TranslationProvider {
  name: string;
  translate(japanese: string, signal?: AbortSignal): Promise<string>;
}
export type QuestionKind = 'main-idea' | 'detail' | 'sequence' | 'vocabulary' | 'grammar' | 'reference' | 'intent' | 'inference';
export type QuizLesson = Pick<Lesson, 'id' | 'videoId' | 'segments'>;
export type QuizEvidence = { segmentIds: string[]; quote: string; start: number; end: number };
export type QuizQuestion = {
  id: string; kind: QuestionKind; question: string; options: string[];
  correctIndex: number; explanation: string; evidence: QuizEvidence;
};
export type LessonQuiz = {
  schemaVersion: 1; id: string; lessonId: string; transcriptKey: string;
  generatedAt: string; questions: QuizQuestion[];
};
export interface QuizGenerationProvider {
  name: string;
  // Provider output is untrusted; the application validates it and supplies IDs/times.
  generate(lesson: QuizLesson, signal: AbortSignal): Promise<unknown>;
}
export type QuizAnswerResult = {
  questionId: string; kind: QuestionKind; selectedIndex: number; correctIndex: number;
  correct: boolean; evidence: QuizEvidence;
};
// Portable, versioned learner event. IDs support idempotent future account sync.
export type QuizAttempt = {
  schemaVersion: 1; id: string; lessonId: string; videoId?: string; quizId: string;
  transcriptKey: string; quizAttempted: true; startedAt: string; updatedAt: string;
  completedAt: string | null; score: number; totalQuestions: number; results: QuizAnswerResult[];
};
// A future provider can return qualitative feedback, without claiming a pronunciation score.
export interface PronunciationAnalysisProvider {
  name: string;
  analyze(recording: Blob, target: Segment): Promise<{ recognizedText?: string; feedback: string[] }>;
}
