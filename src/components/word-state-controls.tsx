'use client';
import { markWords } from '@/lib/knowledge/client';
import { wordStates } from '@/lib/knowledge/types';
import { useWordKnowledge } from './use-word-knowledge';
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
            disabled={!valid}
            onClick={() => markWords([{ lemma, reading }], value)}
          >
            {value[0].toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>
      <small>
        {states[lemma]
          ? 'Saved across transcripts on this device.'
          : 'Unmarked words are treated as Unknown.'}{' '}
        States are separate from review scheduling.
      </small>
    </div>
  );
}
