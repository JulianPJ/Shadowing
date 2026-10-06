'use client';
import Link from 'next/link';
import { ArrowRight, Headphones } from 'lucide-react';
import { useLibrary } from './use-library';
import { lessonCompleted } from '@/lib/storage/learning';
export function LibraryPreview() {
  const { lessons, state, remote } = useLibrary();
  const unfinished = lessons.filter((item) => !lessonCompleted(item.lesson)).slice(0, 3);
  const synced = remote
    .filter((item) => !item.completed && !lessons.some((l) => l.lesson.id === item.lesson.lessonId))
    .slice(0, 3 - unfinished.length);
  return (
    <section className="recent-section library-preview" aria-labelledby="continue-title">
      <div className="section-heading">
        <h2 id="continue-title">Continue watching</h2>
        <Link className="text-button" href="/library">
          My Library <ArrowRight size={15} />
        </Link>
      </div>
      {unfinished.length || synced.length ? (
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
                  Section {item.index + 1} of {item.lesson.segments.length}
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
      ) : (
        <p className="muted">
          Your next visit starts where you paused. Prepare a video or try the studio sample.
        </p>
      )}
      {state.queue.length ? (
        <p className="library-queue-note">
          <Link href="/library">
            {state.queue.length} {state.queue.length === 1 ? 'link' : 'links'} queued for later{' '}
            <ArrowRight size={14} />
          </Link>
        </p>
      ) : null}
    </section>
  );
}
