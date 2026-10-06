'use client';
import { changeReview } from '@/lib/review/client';
import type { ReviewSnapshot } from '@/lib/review/types';
export function ReviewEntryActions({ entryId, data }: { entryId: string; data: ReviewSnapshot }) {
  const card = data.cards.find((c) => c.entryId === entryId);
  return (
    <div className="review-entry-actions">
      <button
        className="button small-button"
        onClick={() =>
          changeReview(
            card && card.status !== 'suspended'
              ? {
                  action: 'suspend',
                  entryId,
                  revision: card.revision,
                  operationId: crypto.randomUUID(),
                }
              : {
                  action: 'enroll',
                  entryIds: [entryId],
                  deckId: 'inbox',
                  enrolledAt: new Date().toISOString(),
                },
          )
        }
      >
        {card && card.status !== 'suspended' ? 'Remove from review' : 'Add to review'}
      </button>
      {data.decks.map((deck) => (
        <label key={deck.id}>
          <input
            type="checkbox"
            checked={data.memberships.some((m) => m.entryId === entryId && m.deckId === deck.id)}
            onChange={(e) =>
              changeReview({
                action: 'membership',
                entryIds: [entryId],
                deckId: deck.id,
                remove: !e.target.checked,
              })
            }
          />
          {deck.name}
        </label>
      ))}
    </div>
  );
}
