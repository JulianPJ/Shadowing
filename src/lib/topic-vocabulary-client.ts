import type { Lesson } from './types';
import { japaneseMorphology } from './furigana-client';
import { rankTopicVocabulary, type TopicVocabularyAnalysis } from './topic-vocabulary';

const MAX_TOPIC_VOCABULARY_CHARACTERS = 120000;

export async function analyzeTopicVocabulary(
  lesson: Lesson,
  signal?: AbortSignal,
): Promise<TopicVocabularyAnalysis> {
  const characters = lesson.segments.reduce(
    (total, segment) => total + Array.from(segment.japanese).length,
    0,
  );
  if (characters > MAX_TOPIC_VOCABULARY_CHARACTERS)
    throw new Error('This transcript is too large for the topic vocabulary overview.');
  if (signal?.aborted) throw new Error('Topic vocabulary analysis was cancelled.');

  const analyzed = await Promise.all(
    lesson.segments.map((segment) => japaneseMorphology(segment.japanese)),
  );
  if (signal?.aborted) throw new Error('Topic vocabulary analysis was cancelled.');
  return rankTopicVocabulary(lesson.segments, analyzed);
}
