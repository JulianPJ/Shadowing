'use client';
import { useEffect, useState } from 'react';
import { useAccount } from './account';
import { cachedReview, pendingReview, refreshReview } from '@/lib/review/client';
import { emptyReview } from '@/lib/review/local';
import type { ReviewSnapshot } from '@/lib/review/types';
import { readStorage } from '@/lib/storage/browser';

/**
 * The account review schedule. Edits apply locally first and sync in the background; the only
 * surfaced problems are a conflicting edit from another device, or no schedule at all.
 */
export function useReview() {
  const account = useAccount();
  const [loaded, setLoaded] = useState<{
    owner: string;
    data: ReviewSnapshot;
    pending: number;
    conflict: string;
    settled: boolean;
  } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const owner = account.user?.id;
    if (!owner) return;
    let active = true;
    let settled = false;
    const update = () => {
      if (active)
        setLoaded({
          owner,
          data: cachedReview(),
          pending: pendingReview().length,
          conflict: readStorage('review:conflict', ''),
          settled,
        });
    };
    update();
    window.addEventListener('hibiki:review-change', update);
    const cross = (event: StorageEvent) => {
      if (event.key?.includes(':review:')) update();
    };
    window.addEventListener('storage', cross);
    void refreshReview()
      .then(() => {
        if (active) setError('');
      })
      .catch(() => {
        if (active && !cachedReview().cards.length)
          setError('Your review schedule could not load. Check your connection and try again.');
      })
      .finally(() => {
        settled = true;
        update();
      });
    return () => {
      active = false;
      window.removeEventListener('hibiki:review-change', update);
      window.removeEventListener('storage', cross);
    };
  }, [account.user?.id]);
  const owned = loaded?.owner === account.user?.id ? loaded : null;
  return {
    data: owned?.data ?? emptyReview(),
    pending: owned?.pending ?? 0,
    error: owned ? error : '',
    conflict: owned?.conflict ?? '',
    loading: !!account.user && !owned?.settled,
    refresh: async () => {
      await refreshReview({ force: true });
      setError('');
    },
  };
}
