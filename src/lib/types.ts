export type Cue = {
  start: number;
  end: number;
  text: string;
  translation?: string;
  estimated?: boolean;
};
export type Segment = {
  id: string;
  start: number;
  end: number;
  japanese: string;
  translation?: string;
  estimated?: boolean;
};
export type LinkedMediaSource = { schemaVersion: 1; canonicalUrl: string; contentKey: string } & (
  | { type: 'youtube'; provider: 'youtube'; videoId: string }
  | { type: 'vimeo'; provider: 'vimeo'; videoId: string }
  | { type: 'direct'; discoveredFrom?: string }
);
/**
 * A video on another web page, played in its own tab through the Hibiki Bridge extension. It has
 * no shared content identity: the page may need a login, and its media is not Hibiki's to fetch.
 */
export type PageMediaSource = {
  schemaVersion: 1;
  type: 'page';
  canonicalUrl: string;
  pageKey: string;
};
export type MediaSource =
  | LinkedMediaSource
  | PageMediaSource
  | { schemaVersion: 1; type: 'local'; fileName: string }
  | { schemaVersion: 1; type: 'demo' };
export type TranscriptSource = {
  schemaVersion: 1;
  type: 'provider-captions' | 'user-upload' | 'user-paste' | 'generated' | 'authored';
  language: 'ja';
  provenance: string;
  provider?: string;
  transcriptHash?: string;
  normalizationVersion: 1;
  segmentationVersion: 1;
};
export type ResolvedMedia = {
  originalUrl: string;
  media: LinkedMediaSource;
  title?: string;
  author?: string;
};
export type Lesson = {
  id: string;
  title: string;
  author: string;
  source: 'demo' | 'youtube' | 'vimeo' | 'direct' | 'upload' | 'page';
  videoId?: string;
  mediaUrl?: string;
  mediaName?: string;
  segments: Segment[];
  // Additive contracts keep legacy lesson IDs and transcript-keyed learning artifacts intact.
  mediaSource?: MediaSource;
  transcript?: TranscriptSource;
  transcriptSource: string;
  notice?: string;
};
export type Mode = 'shadowing' | 'continuous';
export type PlaybackState = 'ready' | 'listening' | 'paused' | 'your-turn' | 'complete';
export interface TranscriptionProvider<Input = string> {
  name: string;
  transcribe(
    input: Input,
    signal?: AbortSignal,
  ): Promise<{ cues: Cue[]; title?: string; author?: string; provider?: string }>;
}
export type TranslationContext = { previousJapanese?: string; nextJapanese?: string };
export interface TranslationProvider {
  name: string;
  translate(japanese: string, signal?: AbortSignal, context?: TranslationContext): Promise<string>;
}
export type QuestionKind =
  | 'main-idea'
  | 'detail'
  | 'sequence'
  | 'vocabulary'
  | 'grammar'
  | 'reference'
  | 'intent'
  | 'inference';
export type QuizLesson = Pick<Lesson, 'id' | 'videoId' | 'segments'>;
export type QuizEvidence = { segmentIds: string[]; quote: string; start: number; end: number };
export type QuizQuestion = {
  id: string;
  kind: QuestionKind;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  evidence: QuizEvidence;
};
export type LessonQuiz = {
  schemaVersion: 1;
  id: string;
  lessonId: string;
  transcriptKey: string;
  generatedAt: string;
  questions: QuizQuestion[];
};
export interface QuizGenerationProvider {
  name: string;
  // Provider output is untrusted; the application validates it and supplies IDs/times.
  generate(lesson: QuizLesson, signal: AbortSignal): Promise<unknown>;
}
export type JlptLevel = 'N5' | 'N4' | 'N3' | 'N2' | 'N1';
export type DifficultyLevel = 1 | 2 | 3 | 4 | 5;
export type DifficultyEvidence = {
  segmentId: string;
  quote: string;
  explanation: string;
  start: number;
  end: number;
};
export type DifficultyDimension = {
  level: DifficultyLevel;
  label: string;
  explanation: string;
  examples: DifficultyEvidence[];
};
export type SpeechSpeed = {
  metricVersion: 1;
  value: number | null;
  unit: 'Japanese characters/min';
  level: DifficultyLevel | null;
  label: string;
  explanation: string;
  japaneseCharacters: number;
  activeSeconds: number;
  excludedGapSeconds: number;
};
export type DifficultyCoverage = {
  strategyVersion: 2;
  totalSegments: number;
  sampledSegments: number;
  totalCharacters: number;
  sampledCharacters: number;
};
// Content-only record: reference by id + transcriptKey in future lesson-history events.
export type ContentDifficultyAnalysis = {
  schemaVersion: 1;
  id: string;
  lessonId: string;
  transcriptKey: string;
  generatedAt: string;
  overall: {
    jlptMin: JlptLevel;
    jlptMax: JlptLevel;
    label: string;
    explanation: string;
    confidence: 'low' | 'medium' | 'high';
  };
  vocabulary: DifficultyDimension;
  grammar: DifficultyDimension;
  speechSpeed: SpeechSpeed;
  conversationalComplexity: DifficultyDimension;
  coverage: DifficultyCoverage;
};
export type DifficultyAnalysisInput = { japanese: string; coverage: DifficultyCoverage };
export interface DifficultyAnalysisProvider {
  name: string;
  analyze(input: DifficultyAnalysisInput, signal: AbortSignal): Promise<unknown>;
}
export type QuizAnswerResult = {
  questionId: string;
  kind: QuestionKind;
  selectedIndex: number;
  correctIndex: number;
  correct: boolean;
  evidence: QuizEvidence;
};
// Portable, versioned learner event. IDs support idempotent future account sync.
export type QuizAttempt = {
  schemaVersion: 1;
  id: string;
  lessonId: string;
  videoId?: string;
  quizId: string;
  transcriptKey: string;
  quizAttempted: true;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  score: number;
  totalQuestions: number;
  results: QuizAnswerResult[];
};
// A future provider can return qualitative feedback, without claiming a pronunciation score.
export interface PronunciationAnalysisProvider {
  name: string;
  analyze(
    recording: Blob,
    target: Segment,
  ): Promise<{ recognizedText?: string; feedback: string[] }>;
}
