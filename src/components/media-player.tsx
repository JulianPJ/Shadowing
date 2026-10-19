'use client';
import Link from 'next/link';
import { forwardRef, useState, type ReactNode } from 'react';
import type { Lesson } from '@/lib/types';
import { lessonMedia } from '@/lib/media';
import { YouTubeMedia } from './media-youtube';
import { VimeoMedia } from './media-vimeo';
import { HtmlMedia } from './media-html';
import { PageMedia } from './media-page';

export interface MediaHandle {
  play(): Promise<void>;
  pause(): void;
  seek(time: number): void;
  time(): number;
  setSpeed(speed: number): void;
  isPlaying(): boolean;
}
export type MediaPlayerProps = {
  lesson: Lesson;
  speed: number;
  initialTime: number;
  onReady: () => void;
  onPlaying: (playing: boolean) => void;
  onEnded: () => void;
  onError: (message: string) => void;
  /** Rendered over the picture, e.g. Studio subtitles. */
  overlay?: ReactNode;
  /** The current line; a page video shows it over the original player. */
  caption?: string;
};

/**
 * Do not load third-party embed scripts or iframes as a side effect of merely opening a lesson.
 * Consent is per media source and visit: no additional persistent identifier is needed.
 */
const ExternalMedia = forwardRef<
  MediaHandle,
  MediaPlayerProps & { provider: 'youtube' | 'vimeo' }
>(function ExternalMedia({ provider, ...props }, ref) {
  const [loaded, setLoaded] = useState(false);
  if (loaded)
    return provider === 'youtube' ? (
      <YouTubeMedia ref={ref} {...props} />
    ) : (
      <VimeoMedia ref={ref} {...props} />
    );
  const name = provider === 'youtube' ? 'YouTube' : 'Vimeo';
  return (
    <div className="media-frame external-media-gate">
      <div className="external-media-choice">
        <p className="external-media-title">Play this video on {name}</p>
        <p>
          Loading this player connects your browser to {name}, which may use cookies or similar
          technologies. No {name} player is loaded until you choose to continue. See our{' '}
          <Link href="/cookies">Cookie &amp; Local Storage Policy</Link>.
        </p>
        <button type="button" className="button primary" onClick={() => setLoaded(true)}>
          Load {name} video
        </button>
      </div>
    </div>
  );
});

export const MediaPlayer = forwardRef<MediaHandle, MediaPlayerProps>(
  function MediaPlayer(props, ref) {
    const source = lessonMedia(props.lesson);
    if (source.type === 'youtube' || source.type === 'vimeo')
      return (
        <ExternalMedia
          key={source.canonicalUrl}
          provider={source.type}
          ref={ref}
          {...props}
        />
      );
    if (source.type === 'page') return <PageMedia ref={ref} {...props} />;
    return (
      <HtmlMedia
        key={
          props.lesson.mediaUrl ||
          (source.type === 'direct' ? source.canonicalUrl : props.lesson.id)
        }
        ref={ref}
        {...props}
      />
    );
  },
);
