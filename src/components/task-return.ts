'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { safeReturnPath } from '@/lib/auth/return-path';

const lastPracticeKey = 'hibiki:last-practice-return';
export function useTaskReturn() {
  const pathname = usePathname();
  const [practice, setPractice] = useState('/');
  const [destination, setDestination] = useState('/account');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Return to the persisted current position, rather than an older incoming section link.
    if (pathname?.startsWith('/practice/')) {
      try {
        sessionStorage.setItem(lastPracticeKey, pathname);
      } catch {
        /* Storage is optional. */
      }
    }
    let previous = '/';
    try {
      previous = safeReturnPath(sessionStorage.getItem(lastPracticeKey), '/');
    } catch {
      /* Storage is optional. */
    }
    const current = safeReturnPath(
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
    );
    // Browser-only history is hydrated once for each route.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPractice(previous);
    setDestination(params.has('returnTo') ? safeReturnPath(params.get('returnTo')) : current);
  }, [pathname]);
  return { practice, destination };
}
