'use client';
import { useId, type ReactNode } from 'react';
import type { LexiconResult } from '@/lib/lexicon/types';
export function LexiconDefinitions({
  result,
  onSense,
  selectedSense,
}: {
  result: LexiconResult;
  onSense?: (meaning: string, reading: string, lemma: string, senseId: string) => void;
  selectedSense?: string;
}) {
  // One radio group across every match: a lookup saves exactly one sense.
  const group = useId();
  return (
    <div className="lexicon-definitions">
      {result.matches.length ? (
        result.matches.map((match) => (
          <article
            className="lexicon-match"
            key={`${match.entry.id}:${match.lemma}:${match.reading}`}
          >
            <div className="lexicon-term">
              <strong lang="ja">{match.lemma}</strong>
              <span lang="ja">{match.reading}</span>
              {match.common ? (
                <span className="lexicon-common">Common in JMdict</span>
              ) : (
                <span className="small muted">No commonness marker</span>
              )}
            </div>
            {match.deinflected ? (
              <p className="small muted">
                Dictionary form of <span lang="ja">{result.selected}</span>
              </p>
            ) : null}
            <ol className={onSense ? 'lexicon-senses selectable' : 'lexicon-senses'}>
              {match.senses.map((sense, index) => {
                const id = `${match.entry.id}:${match.lemma}:${match.reading}:${index}`;
                const details: ReactNode = (
                  <>
                    <span className="lexicon-pos">
                      {sense.partOfSpeech.map((tag) => result.tags[tag] ?? tag).join(' · ')}
                    </span>
                    <p>{sense.gloss.join('; ')}</p>
                    {sense.info.length ? <small>{sense.info.join(' · ')}</small> : null}
                    {[...sense.field, ...sense.dialect, ...sense.misc].length ? (
                      <small>
                        {[...sense.field, ...sense.dialect, ...sense.misc]
                          .map((tag) => result.tags[tag] ?? tag)
                          .join(' · ')}
                      </small>
                    ) : null}
                  </>
                );
                return (
                  <li key={index}>
                    {onSense ? (
                      <label className="lexicon-sense-option">
                        <input
                          type="radio"
                          name={group}
                          aria-label={`Use sense ${index + 1}`}
                          checked={selectedSense === id}
                          onChange={() =>
                            onSense(
                              sense.gloss.join('; ').slice(0, 1000),
                              match.reading,
                              match.lemma,
                              id,
                            )
                          }
                        />
                        <span className="lexicon-sense-number">{index + 1}.</span>
                        <span>{details}</span>
                      </label>
                    ) : (
                      details
                    )}
                  </li>
                );
              })}
            </ol>
          </article>
        ))
      ) : (
        <p className="small muted">
          No exact lexical entry found. Proper names, new slang and longer phrases may need the
          sentence meaning or your own gloss.
        </p>
      )}
    </div>
  );
}
