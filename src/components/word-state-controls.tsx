'use client';
import { markWords } from '@/lib/knowledge/client';
import { wordStates } from '@/lib/knowledge/types';
import { useWordKnowledge } from './use-word-knowledge';
const descriptions = {
  unknown: 'A word you want to learn; unmarked words count as Unknown.',
  learning: 'You are working on recognising this word.',
  known: 'You choose to count this word as familiar in vocabulary coverage.',
  ignored: 'Excluded from vocabulary coverage without deleting the word.',
};
export function WordStateControls({ lemma, reading }: { lemma: string; reading?: string | null }) {
  const { states } = useWordKnowledge();
  const state = states[lemma]?.state ?? 'unknown';
  const valid = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(lemma);
  return (
    <div className="word-state-controls" aria-label={`Word state for ${lemma}`}>
      <span className="small">Word knowledge</span>
      <div>
        {wordStates.map((value) => (
          <button
            key={value}
            className={`word-state-choice word-state-${value}`}
            aria-pressed={state === value}
            title={descriptions[value]}
            disabled={!valid}
            onClick={() => markWords([{ lemma, reading }], value)}
          >
            {value[0].toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>
      <small>
        {descriptions[state]} Marks apply across lessons. Saving a card and scheduling reviews are
        separate choices.
      </small>
    </div>
  );
}
