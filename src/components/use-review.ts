'use client';
import { useEffect, useState } from 'react';
import { useAccount } from './account';
import { cachedReview, pendingReview, refreshReview } from '@/lib/review/client';
import { emptyReview } from '@/lib/review/local';
import type { ReviewSnapshot } from '@/lib/review/types';
import { readStorage } from '@/lib/storage/browser';
export function useReview() {
  const account = useAccount();
  const [loaded, setLoaded] = useState<{
    owner: string;
    data: ReviewSnapshot;
    pending: number;
    conflict: string;
  } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const owner = account.user?.id;
    if (!owner) return;
    let active = true;
    const update = () => {
      if (active && !pendingReview().length) setError('');
      if (active)
        setLoaded({
          owner,
          data: cachedReview(),
          pending: pendingReview().length,
          conflict: readStorage('review:conflict', ''),
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
      .catch((e) => {
        if (active) setError((e as Error).message);
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
    error: account.user ? error : '',
    conflict: owned?.conflict ?? '',
    refresh: async () => {
      await refreshReview();
      setError('');
    },
  };
}
