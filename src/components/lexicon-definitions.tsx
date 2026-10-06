'use client';
import type { LexiconResult } from '@/lib/lexicon/types';
export function LexiconDefinitions({
  result,
  onSense,
}: {
  result: LexiconResult;
  onSense?: (meaning: string, reading: string) => void;
}) {
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
            <ol>
              {match.senses.map((sense, index) => (
                <li key={index}>
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
                  {onSense ? (
                    <button
                      className="text-button"
                      onClick={() => onSense(sense.gloss.join('; ').slice(0, 1000), match.reading)}
                    >
                      Use sense {index + 1}
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
          </article>
        ))
      ) : (
        <p className="small muted">
          No exact lexical entry found. Proper names, new slang and longer phrases may need the
          sentence meaning or your own gloss.
        </p>
      )}
      <p className="lexicon-attribution">
        <a
          href="https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project"
          target="_blank"
          rel="noreferrer"
        >
          JMdict © James William Breen / EDRDG
        </a>{' '}
        ·{' '}
        <a href="https://www.edrdg.org/edrdg/licence.html" target="_blank" rel="noreferrer">
          CC BY-SA 4.0
        </a>{' '}
        · {result.dictionaryDate}. English data converted by scriptin, compacted by Hibiki.
        Commonness is a dictionary marker, not a frequency rank. No dictionary audio is included.
      </p>
    </div>
  );
}
