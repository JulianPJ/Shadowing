'use client';
import { useState } from 'react';
import { changeReview } from '@/lib/review/client';
import type { ReviewSnapshot } from '@/lib/review/types';
export function ReviewEntryActions({ entryId, data }: { entryId: string; data: ReviewSnapshot }) {
  const card = data.cards.find((value) => value.entryId === entryId);
  const enrolled = card && card.status !== 'suspended';
  const memberships = data.decks.filter((deck) =>
    data.memberships.some((member) => member.entryId === entryId && member.deckId === deck.id),
  );
  const [error, setError] = useState('');
  function change(operation: Parameters<typeof changeReview>[0]) {
    try {
      changeReview(operation);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update this word.');
    }
  }
  return (
    <div className="review-entry-actions">
      <span className="small muted">
        {enrolled ? 'In review' : card ? 'Review paused' : 'Saved only'}
      </span>
      <button
        className="button small-button"
        onClick={() =>
          change(
            enrolled
              ? {
                  action: 'suspend',
                  entryId,
                  revision: card.revision,
                  operationId: crypto.randomUUID(),
                }
              : {
                  action: 'enroll',
                  entryIds: [entryId],
                  deckId: memberships[0]?.id ?? 'inbox',
                  enrolledAt: new Date().toISOString(),
                },
          )
        }
      >
        {enrolled ? 'Pause review' : 'Add to review'}
      </button>
      <details className="entry-decks">
        <summary>
          Decks · {memberships.map((deck) => deck.name).join(', ') || 'None assigned'}
        </summary>
        <p className="small muted">
          Add to another deck without changing this word’s review schedule.
        </p>
        <label>
          Add to deck
          <select
            value=""
            onChange={(event) => {
              if (event.target.value)
                change({
                  action: 'membership',
                  entryIds: [entryId],
                  deckId: event.target.value,
                  remove: false,
                });
            }}
          >
            <option value="">Choose deck</option>
            {data.decks
              .filter((deck) => !memberships.some((member) => member.id === deck.id))
              .map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deck.name}
                </option>
              ))}
          </select>
        </label>
        {memberships.map((deck) => (
          <label className="entry-deck-membership" key={deck.id}>
            <input
              type="checkbox"
              checked
              onChange={() =>
                change({ action: 'membership', entryIds: [entryId], deckId: deck.id, remove: true })
              }
            />
            {deck.name}
          </label>
        ))}
      </details>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
