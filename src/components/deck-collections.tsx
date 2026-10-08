'use client';
import Link from 'next/link';
import { useState } from 'react';
import { changeReview } from '@/lib/review/client';
import { dueReviews } from '@/lib/review-scheduler';
import type { ReviewSnapshot } from '@/lib/review/types';

export function DeckCollections({
  data,
  onError,
}: {
  data: ReviewSnapshot;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  const now = new Date(),
    endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  return (
    <section className="deck-collections" aria-label="Your decks">
      <p className="collection-explanation">
        Decks group saved words for study. A word can belong to several decks and keeps one review
        schedule. Tags describe a word; word knowledge is your own assessment.
      </p>
      <form
        className="collection-create"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          try {
            changeReview({ action: 'deck', id: crypto.randomUUID(), name: name.trim() });
            setNotice(`Created ${name.trim()}. Select saved words to add them to this deck.`);
            setName('');
            onError('');
          } catch (error) {
            onError(error instanceof Error ? error.message : 'Could not create this deck.');
          }
        }}
      >
        <label>
          New deck
          <input
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Travel, everyday conversations…"
          />
        </label>
        <button className="button" disabled={!name.trim()}>
          Create deck
        </button>
      </form>
      {notice ? (
        <p className="collection-notice" role="status">
          {notice}
        </p>
      ) : null}
      <div className="deck-list">
        {data.decks.map((deck) => {
          const ids = new Set(
            data.memberships
              .filter((member) => member.deckId === deck.id)
              .map((member) => member.entryId),
          );
          const cards = data.cards.filter(
            (card) => ids.has(card.entryId) && card.status !== 'suspended',
          );
          const dueNow = dueReviews(cards, now.toISOString()).length;
          return (
            <article className="deck-collection" key={deck.id} aria-label={`${deck.name} deck`}>
              <div className="deck-collection-heading">
                <div>
                  <h2>{deck.name}</h2>
                  <p>
                    {deck.id === 'inbox'
                      ? 'Default collection for newly saved words.'
                      : `${ids.size} saved ${ids.size === 1 ? 'word' : 'words'}`}
                  </p>
                </div>
                <Link
                  className="button primary"
                  href={`/review?deck=${encodeURIComponent(deck.id)}`}
                >
                  Study · {dueNow} ready
                </Link>
              </div>
              <dl className="deck-counts">
                <div>
                  <dt>New</dt>
                  <dd>{cards.filter((card) => card.status === 'new').length}</dd>
                </div>
                <div>
                  <dt>Learning</dt>
                  <dd>{cards.filter((card) => card.status === 'learning').length}</dd>
                </div>
                <div>
                  <dt>Due today</dt>
                  <dd>
                    {
                      cards.filter(
                        (card) =>
                          card.status === 'review' &&
                          Date.parse(card.dueAt) <= endOfToday.getTime(),
                      ).length
                    }
                  </dd>
                </div>
              </dl>
              {!ids.size ? (
                <p className="small muted">
                  This deck is empty. Select saved words and choose this deck to add them.
                </p>
              ) : null}
              <div className="deck-collection-actions">
                <Link
                  className="button small-button"
                  href={`/dictionary?deck=${encodeURIComponent(deck.id)}`}
                >
                  Browse saved words
                </Link>
                <DeckSettings deck={deck} onError={onError} onNotice={setNotice} />
              </div>
            </article>
          );
        })}
      </div>
      <p className="small muted">
        Due today includes overdue scheduled reviews. Learning words may return later today. Saving
        a word and adding it to review are separate choices.
      </p>
    </section>
  );
}

function DeckSettings({
  deck,
  onError,
  onNotice,
}: {
  deck: ReviewSnapshot['decks'][number];
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [name, setName] = useState(deck.name);
  return (
    <details className="deck-settings">
      <summary>Manage deck</summary>
      <p className="small muted">
        Adding a word keeps its other deck memberships. Moving it removes its other memberships. Its
        review schedule stays the same.
      </p>
      {deck.id === 'inbox' ? (
        <p className="small muted">
          Inbox is the default collection and is kept available for new words.
        </p>
      ) : (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              try {
                changeReview({ action: 'deck', id: deck.id, name: name.trim() });
                onError('');
                onNotice('Deck name saved on this device.');
              } catch (error) {
                onError(error instanceof Error ? error.message : 'Could not rename this deck.');
              }
            }}
          >
            <label>
              Deck name
              <input
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <button
              className="button small-button"
              disabled={!name.trim() || name.trim() === deck.name}
            >
              Rename deck
            </button>
          </form>
          <button
            className="text-button dictionary-remove"
            onClick={() => {
              if (
                !window.confirm(
                  `Delete “${deck.name}”? Saved words and their review schedules stay available. Only this deck and its memberships are removed.`,
                )
              )
                return;
              try {
                changeReview({ action: 'delete-deck', deckId: deck.id });
                onError('');
                onNotice(`Deleted ${deck.name}. Your saved words and review schedules are kept.`);
              } catch (error) {
                onError(error instanceof Error ? error.message : 'Could not delete this deck.');
              }
            }}
          >
            Delete deck
          </button>
        </>
      )}
    </details>
  );
}
