import { timestamp } from '@/lib/youtube';
import type { Lesson } from '@/lib/types';

const fallbackLabel: Partial<Record<Lesson['source'], string>> = {
  upload: 'Your media',
  vimeo: 'Vimeo',
  direct: 'Direct video',
  page: 'Web page',
};

/**
 * A 16:9 preview in the Discover card style. YouTube lessons use the public i.ytimg.com still
 * for their video ID (the same host Discover already shows); the demo uses its poster; local and
 * other media get the 響 placeholder rather than a fetched image.
 */
export function LessonThumbnail({
  source,
  videoId,
  duration,
  progress,
}: {
  source: Lesson['source'];
  videoId?: string | null;
  duration?: number;
  /** 0–1 share of sections reached; omitted for unprepared or completed items. */
  progress?: number;
}) {
  const youtube = source === 'youtube' && videoId && /^[\w-]{11}$/.test(videoId);
  return (
    <span className="discover-thumbnail lesson-thumbnail">
      {youtube ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          width="320"
          height="180"
        />
      ) : source === 'demo' ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/demo-poster.svg" alt="" width="320" height="180" />
      ) : (
        <span className="discover-image-fallback" aria-hidden="true">
          響<span>{fallbackLabel[source] ?? 'Japanese, in your own time.'}</span>
        </span>
      )}
      {duration ? <span className="discover-duration">{timestamp(duration)}</span> : null}
      {progress !== undefined ? (
        <span className="lesson-thumbnail-progress" aria-hidden="true">
          <span style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} />
        </span>
      ) : null}
    </span>
  );
}

/** The final cue's end time is the practical length of a prepared lesson. */
export function lessonDuration(lesson: Lesson) {
  return lesson.segments.at(-1)?.end ?? 0;
}
