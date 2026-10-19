import type { ReactNode } from 'react';
import Link from 'next/link';

export function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="notices-main">
      <h1>{title}</h1>
      <p className="muted">Effective date: 19 October 2026.</p>
      {children}
      <p>
        Questions about these policies? See <Link href="/contact">Contact Hibiki</Link>.
      </p>
    </main>
  );
}
