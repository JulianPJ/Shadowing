'use client';
import Link from 'next/link';
import { useReview } from './use-review';
import { dueReviews } from '@/lib/review-scheduler';
export function ReviewLink() {
  const { data } = useReview();
  const count = dueReviews(data.cards, new Date().toISOString()).length;
  return (
    <Link className="nav-link" href="/review">
      Review{count ? ` · ${count} due` : ''}
    </Link>
  );
}
