'use client';
import { SectionTabs, TaskReturn } from './chrome';
import { useAccount } from './account';
import { useReview } from './use-review';
import { dueReviews } from '@/lib/review-scheduler';

/** Vocabulary has two views: today's review and the words you have saved or marked. */
export function VocabularyHeader({ active }: { active: 'review' | 'words' }) {
  const account = useAccount();
  const { data } = useReview();
  const due = account.user ? dueReviews(data.cards, new Date().toISOString()).length : 0;
  return (
    <>
      <TaskReturn />
      <h1>Vocabulary</h1>
      <SectionTabs
        label="Vocabulary"
        active={active}
        tabs={[
          ['review', due ? `Review · ${due} due` : 'Review', '/review'],
          ['words', 'Words', '/words'],
        ]}
      />
    </>
  );
}
