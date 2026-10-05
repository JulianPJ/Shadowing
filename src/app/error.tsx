'use client';
import Link from 'next/link';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="empty-screen">
      <span className="eyebrow">LET’S TRY AGAIN</span>
      <h1>Something interrupted your practice.</h1>
      <p>Your saved lessons are still in this browser.</p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
      <Link href="/" className="button">
        Back to home
      </Link>
    </main>
  );
}
