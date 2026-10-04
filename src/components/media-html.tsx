'use client';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { ExternalLink, LoaderCircle, Music2 } from 'lucide-react';
import { lessonMedia } from '@/lib/media';
import type { MediaHandle, MediaPlayerProps } from './media-player';

export const HtmlMedia = forwardRef<MediaHandle, MediaPlayerProps>(function HtmlMedia(
  { lesson, speed, initialTime, onReady, onPlaying, onEnded, onError },
  ref,
) {
  const video = useRef<HTMLVideoElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const source = lessonMedia(lesson);
  const url = source.type === 'direct' ? source.canonicalUrl : lesson.mediaUrl;
  useImperativeHandle(
    ref,
    () => ({
      async play() {
        if (video.current) await video.current.play();
      },
      pause() {
        video.current?.pause();
      },
      seek(time) {
        if (video.current) video.current.currentTime = time;
      },
      time() {
        return video.current?.currentTime ?? 0;
      },
      setSpeed(rate) {
        if (video.current) video.current.playbackRate = rate;
      },
      isPlaying() {
        return !!video.current && !video.current.paused && !video.current.ended;
      },
    }),
    [],
  );
  return (
    <div className="media-frame">
      {url ? (
        <video
          ref={video}
          src={url}
          poster={source.type === 'demo' ? '/demo-poster.svg' : undefined}
          playsInline
          controls
          preload="metadata"
          onLoadedMetadata={() => {
            if (!video.current) return;
            // Replay/evidence seeking needs a finite, seekable recording rather than a live stream.
            if (!Number.isFinite(video.current.duration)) {
              const message =
                'This media is a live stream or does not expose a seekable duration. Use a recorded audio/video link.';
              setLoading(false);
              setError(message);
              onError(message);
              return;
            }
            video.current.currentTime = Math.min(initialTime, video.current.duration);
            video.current.playbackRate = speed;
            setLoading(false);
            setError('');
            onReady();
          }}
          onPlay={() => onPlaying(true)}
          onPause={() => onPlaying(false)}
          onEnded={onEnded}
          onError={() => {
            const message =
              source.type === 'direct'
                ? 'This media link could not be played. It may have expired, restrict playback, or use a codec this browser cannot decode. Try another direct link or import your media.'
                : 'This browser could not decode the selected media. Choose an audio/video file supported by your browser.';
            setError(message);
            setLoading(false);
            onError(message);
          }}
        >
          <track
            kind="captions"
            src={source.type === 'demo' ? '/demo.vtt' : undefined}
            srcLang="ja"
            label="Japanese"
          />
        </video>
      ) : (
        <div className="missing-media">
          <Music2 size={36} />
          <p>Reattach your media to continue.</p>
        </div>
      )}
      {loading && url ? (
        <div className="media-loading">
          <LoaderCircle className="spin" size={22} />
          <span>Getting your player ready…</span>
        </div>
      ) : null}
      {error ? (
        <div className="media-error">
          <p>{error}</p>
        </div>
      ) : null}
      {source.type === 'direct' && source.discoveredFrom ? (
        <a
          className="text-button media-source-link"
          href={source.canonicalUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open extracted media <ExternalLink size={14} />
        </a>
      ) : null}
    </div>
  );
});
