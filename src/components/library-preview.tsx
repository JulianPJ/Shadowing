'use client';
import Link from 'next/link';
import { ArrowRight, Headphones } from 'lucide-react';
import type { useLibrary } from './use-library';
import { lessonCompleted } from '@/lib/storage/learning';

/** Up to three unfinished lessons, local first, then account lessons to restore. */
export function ContinueRow({ library }: { library: ReturnType<typeof useLibrary> }) {
  const { lessons, remote } = library;
  const unfinished = lessons.filter((item) => !lessonCompleted(item.lesson)).slice(0, 3);
  const synced = remote
    .filter((item) => !item.completed && !lessons.some((l) => l.lesson.id === item.lesson.lessonId))
    .slice(0, 3 - unfinished.length);
  if (!unfinished.length && !synced.length) return null;
  return (
    <section className="recent-section library-preview" aria-labelledby="continue-title">
      <h2 id="continue-title">Continue watching</h2>
      <div className="recent-grid">
        {unfinished.map((item) => (
          <Link
            className="recent-card"
            key={item.lesson.id}
            href={`/practice/${encodeURIComponent(item.lesson.id)}`}
          >
            <Headphones size={20} />
            <div>
              <strong>{item.lesson.title}</strong>
              <span>
                Resume · Section {item.index + 1} of {item.lesson.segments.length}
              </span>
            </div>
            <ArrowRight size={16} />
          </Link>
        ))}
        {synced.map((item) => (
          <Link
            className="recent-card"
            key={item.id}
            href={`/practice/${encodeURIComponent(item.lesson.lessonId)}`}
          >
            <Headphones size={20} />
            <div>
              <strong>{item.lesson.title}</strong>
              <span>
                Section {item.position + 1} of {item.lesson.segmentCount}
                {!item.mediaAvailable ? ' · Reattach source' : ''}
              </span>
            </div>
            <ArrowRight size={16} />
          </Link>
        ))}
      </div>
    </section>
  );
}
