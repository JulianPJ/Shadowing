'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { PageStream } from '@/lib/extension/bridge';
import type { MediaHandle, MediaPlayerProps } from './media-player';

type StreamMediaProps = MediaPlayerProps & { stream: PageStream; onUnavailable: () => void };

/**
 * A web page's own video stream played inside Hibiki. Hibiki Bridge lets this tab request it the
 * way the page does; HLS plays through hls.js, loaded only for these lessons. Any failure to play
 * calls `onUnavailable`, and the lesson falls back to controlling the video in its own tab.
 */
export const StreamMedia = forwardRef<MediaHandle, StreamMediaProps>(function StreamMedia(
  { stream, speed, initialTime, onReady, onPlaying, onEnded, onError, onUnavailable, overlay },
  ref,
) {
  const video = useRef<HTMLVideoElement>(null);
  const [loading, setLoading] = useState(true);
  const unavailable = useRef(onUnavailable);
  const start = useRef(initialTime);
  // hls.js reports and recovers its own media errors; the element's error event is for files.
  const throughHls = useRef(false);
  useEffect(() => {
    unavailable.current = onUnavailable;
  });

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (stream.type === 'file') {
      element.src = stream.url;
      return;
    }
    let active = true;
    let destroy = () => {};
    void import('hls.js').then(
      ({ default: Hls }) => {
        if (!active) return;
        if (!Hls.isSupported()) {
          if (element.canPlayType('application/vnd.apple.mpegurl')) element.src = stream.url;
          else unavailable.current();
          return;
        }
        throughHls.current = true;
        const hls = new Hls({ startPosition: start.current });
        destroy = () => hls.destroy();
        let recovered = false;
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
            recovered = true;
            hls.recoverMediaError();
          } else unavailable.current();
        });
        hls.loadSource(stream.url);
        hls.attachMedia(element);
      },
      () => unavailable.current(),
    );
    return () => {
      active = false;
      destroy();
    };
  }, [stream]);

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
      <video
        ref={video}
        playsInline
        controls
        preload="metadata"
        onLoadedMetadata={() => {
          if (!video.current) return;
          if (!Number.isFinite(video.current.duration)) {
            const message =
              'This video is a live stream, so it has no fixed sections to practise. Try a recorded video.';
            setLoading(false);
            onError(message);
            return;
          }
          if (Math.abs(video.current.currentTime - start.current) > 0.5)
            video.current.currentTime = Math.min(start.current, video.current.duration);
          video.current.playbackRate = speed;
          setLoading(false);
          onReady();
        }}
        onPlay={() => onPlaying(true)}
        onPause={() => onPlaying(false)}
        onEnded={onEnded}
        onError={() => {
          if (!throughHls.current) unavailable.current();
        }}
      />
      {loading ? (
        <div className="media-loading">
          <LoaderCircle className="spin" size={22} />
          <span>Getting your player ready…</span>
        </div>
      ) : null}
      {overlay}
    </div>
  );
});
