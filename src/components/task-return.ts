'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { safeReturnPath } from '@/lib/auth/return-path';

const lastPracticeKey = 'hibiki:last-practice-return';
const practiceOriginKey = 'hibiki:practice-origin';
/** Destinations Practice can return to. Practice and /prepare are working surfaces, not origins. */
const origins: readonly (readonly [path: string, label: string])[] = [
  ['/', 'Home'],
  ['/discover', 'Discover'],
  ['/library', 'Library'],
  ['/review', 'Vocabulary'],
  ['/words', 'Vocabulary'],
  ['/dictionary', 'Vocabulary'],
  ['/profile', 'Profile'],
  ['/progress', 'Profile'],
  ['/account', 'Profile'],
];
const libraryOrigin = { href: '/library', label: 'Library' };
function originFor(path: string) {
  const pathname = path.split(/[?#]/)[0];
  const label = origins.find(([candidate]) => candidate === pathname)?.[1];
  return label ? { href: path, label } : libraryOrigin;
}

/** Records the current destination URL, e.g. after a filter changes it without navigating. */
export function rememberPracticeOrigin() {
  const { pathname, search, hash } = window.location;
  if (!origins.some(([path]) => path === pathname)) return;
  // Home's query carries one-off Bridge and link hand-offs that must not replay on return.
  const current = pathname === '/' ? '/' : safeReturnPath(`${pathname}${search}${hash}`);
  try {
    sessionStorage.setItem(practiceOriginKey, current);
  } catch {
    /* Storage is optional. */
  }
}

export function useTaskReturn() {
  const pathname = usePathname();
  const [practice, setPractice] = useState('/');
  const [destination, setDestination] = useState('/account');
  const [practiceOrigin, setPracticeOrigin] = useState(libraryOrigin);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const current = safeReturnPath(
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
    );
    // Return to the persisted current position, rather than an older incoming section link.
    if (pathname?.startsWith('/practice/')) {
      try {
        sessionStorage.setItem(lastPracticeKey, pathname);
      } catch {
        /* Storage is optional. */
      }
    }
    // The last destination visited is where Practice's breadcrumb returns, filters included.
    rememberPracticeOrigin();
    let previous = '/';
    let origin = libraryOrigin;
    try {
      previous = safeReturnPath(sessionStorage.getItem(lastPracticeKey), '/');
      origin = originFor(safeReturnPath(sessionStorage.getItem(practiceOriginKey), '/library'));
    } catch {
      /* Storage is optional. */
    }
    // Browser-only history is hydrated once for each route.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPractice(previous);
    setPracticeOrigin(origin);
    setDestination(params.has('returnTo') ? safeReturnPath(params.get('returnTo')) : current);
  }, [pathname]);
  return { practice, destination, practiceOrigin };
}
