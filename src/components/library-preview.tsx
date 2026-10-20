'use client';
import Link from 'next/link';
import { ArrowRight, Play } from 'lucide-react';
import type { useLibrary } from './use-library';
import { lessonCompleted } from '@/lib/storage/learning';
import { getLiveMedia } from '@/lib/storage/lessons';
import { lessonMedia, sourceLabel } from '@/lib/media';
import { LessonThumbnail, lessonDuration } from './lesson-thumbnail';
import type { Lesson } from '@/lib/types';

type Resumable = {
  key: string;
  href: string;
  title: string;
  source: Lesson['source'];
  videoId?: string | null;
  duration: number;
  index: number;
  total: number;
  label: string;
  /** The Japanese sentence the learner will hear next, when the transcript is on this device. */
  next?: string;
  reattach: boolean;
};

/** Unfinished lessons, most recent first: this device's, then account lessons to restore. */
function resumable(library: ReturnType<typeof useLibrary>): Resumable[] {
  const { lessons, remote } = library;
  const local = lessons
    .filter((item) => !lessonCompleted(item.lesson))
    .map(({ lesson, index }) => ({
      key: lesson.id,
      href: `/practice/${encodeURIComponent(lesson.id)}`,
      title: lesson.title,
      source: lesson.source,
      videoId: lesson.videoId,
      duration: lessonDuration(lesson),
      index,
      total: lesson.segments.length,
      label: sourceLabel(lesson),
      next: lesson.segments[index]?.japanese,
      reattach: lessonMedia(lesson).type === 'local' && !getLiveMedia(lesson.id),
    }));
  const synced = remote
    .filter((item) => !item.completed && !lessons.some((l) => l.lesson.id === item.lesson.lessonId))
    .map((item) => ({
      key: item.id,
      href: `/practice/${encodeURIComponent(item.lesson.lessonId)}`,
      title: item.lesson.title,
      source: item.lesson.source,
      videoId: item.lesson.videoId ?? item.providerMediaId,
      duration: item.lesson.duration,
      index: item.position,
      total: item.lesson.segmentCount,
      label: 'From your account',
      reattach: !item.mediaAvailable,
    }));
  return [...local, ...synced];
}

/** Home's resume region: one lesson to pick up now, and up to two more in progress. */
export function ResumeFeature({ library }: { library: ReturnType<typeof useLibrary> }) {
  const [first, ...rest] = resumable(library);
  if (!first)
    return (
      <section className="library-preview resume-empty" aria-labelledby="continue-title">
        <h2 id="continue-title">Nothing in progress</h2>
        <p>
          You have finished every lesson you started. Find something new, or revisit a favourite.
        </p>
        <div className="resume-empty-actions">
          <Link className="button primary" href="/discover">
            Find a new video <ArrowRight size={16} />
          </Link>
          <Link className="button" href="/library?filter=completed">
            Revisit in Library
          </Link>
        </div>
      </section>
    );
  return (
    <section className="library-preview" aria-labelledby="continue-title">
      <h2 id="continue-title" className="eyebrow">
        CONTINUE WATCHING
      </h2>
      <article className="resume-feature">
        <Link className="library-card-media" href={first.href} tabIndex={-1} aria-hidden="true">
          <LessonThumbnail
            source={first.source}
            videoId={first.videoId}
            duration={first.duration}
            progress={first.index / Math.max(1, first.total)}
          />
        </Link>
        <div className="resume-copy">
          <h3>
            <Link href={first.href}>{first.title}</Link>
          </h3>
          <p className="library-card-meta">
            {first.label} · Section {first.index + 1} of {first.total}
            {first.reattach ? ' · Reattach your file to play' : ''}
          </p>
          {first.next ? (
            <p className="resume-next">
              <span>Your next sentence</span>
              <span lang="ja">{first.next}</span>
            </p>
          ) : null}
          <Link className="button primary resume-button" href={first.href}>
            <Play size={17} /> Resume practice
          </Link>
        </div>
      </article>
      {rest.length ? (
        <ul className="resume-more">
          {rest.slice(0, 2).map((item) => (
            <li key={item.key}>
              <Link href={item.href}>
                <LessonThumbnail
                  source={item.source}
                  videoId={item.videoId}
                  progress={item.index / Math.max(1, item.total)}
                />
                <span>
                  <strong>{item.title}</strong>
                  <span>
                    Resume · Section {item.index + 1} of {item.total}
                    {item.reattach ? ' · Reattach source' : ''}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
