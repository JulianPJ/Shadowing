'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { MediaPlayerProps } from './media-player';
import { lessonMedia } from '@/lib/media';
import { LoaderCircle, ExternalLink, RefreshCw } from 'lucide-react';

import type { MediaHandle } from './media-player';
type YouTubePlayer = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(time: number, allow: boolean): void;
  getCurrentTime(): number;
  setPlaybackRate(rate: number): void;
  getPlayerState(): number;
  destroy(): void;
  getIframe(): HTMLIFrameElement;
};
type YouTubeAPI = {
  Player: new (target: HTMLElement, options: Record<string, unknown>) => YouTubePlayer;
};
declare global {
  interface Window {
    YT?: YouTubeAPI;
    onYouTubeIframeAPIReady?: () => void;
  }
}
let youtubeAPI: Promise<YouTubeAPI> | undefined;
function loadYouTubeAPI(): Promise<YouTubeAPI> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeAPI) return youtubeAPI;
  youtubeAPI = new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      youtubeAPI = undefined;
      reject(new Error('YouTube took too long to load. Check your connection or content blocker.'));
    }, 15000);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout);
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    let script = document.getElementById('youtube-iframe-api') as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = 'youtube-iframe-api';
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      document.head.appendChild(script);
    }
    script.onerror = () => {
      window.clearTimeout(timeout);
      script?.remove();
      youtubeAPI = undefined;
      reject(new Error('YouTube could not load. Check your connection or content blocker.'));
    };
  });
  return youtubeAPI;
}
const errors: Record<number, string> = {
  2: 'The video link is invalid.',
  5: 'This browser could not play the YouTube video.',
  100: 'This video is private, removed, or unavailable.',
  101: 'This creator does not allow embedded playback.',
  150: 'This creator does not allow embedded playback.',
  153: 'YouTube could not verify this embedded player. Open the app in a regular browser tab.',
};

export const YouTubeMedia = forwardRef<MediaHandle, MediaPlayerProps>(function YouTubeMedia(
  { lesson, speed, initialTime, onReady, onPlaying, onEnded, onError, overlay },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const youtube = useRef<YouTubePlayer | null>(null);
  const callbacks = useRef({ onReady, onPlaying, onEnded, onError });
  const speedRef = useRef(speed);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const source = lessonMedia(lesson);
  const videoId = source.type === 'youtube' ? source.videoId : '';
  useEffect(() => {
    callbacks.current = { onReady, onPlaying, onEnded, onError };
  }, [onReady, onPlaying, onEnded, onError]);
  useImperativeHandle(
    ref,
    () => ({
      async play() {
        youtube.current?.playVideo();
      },
      pause() {
        youtube.current?.pauseVideo();
      },
      seek(time) {
        youtube.current?.seekTo(time, true);
      },
      time() {
        return youtube.current?.getCurrentTime() ?? 0;
      },
      setSpeed(rate) {
        youtube.current?.setPlaybackRate(rate);
      },
      isPlaying() {
        return youtube.current?.getPlayerState() === 1;
      },
    }),
    [],
  );
  useEffect(() => {
    let cancelled = false;
    let player: YouTubePlayer | undefined;
    let readyTimeout: ReturnType<typeof setTimeout>;
    setLoading(true);
    setError('');
    const fail = (message: string) => {
      if (!cancelled) {
        setError(message);
        setLoading(false);
        callbacks.current.onError(message);
      }
    };
    loadYouTubeAPI()
      .then((api) => {
        if (cancelled || !host.current) return;
        const target = document.createElement('div');
        host.current.replaceChildren(target);
        readyTimeout = setTimeout(
          () => fail('YouTube hasn’t connected. Check your connection, then retry the player.'),
          18000,
        );
        player = new api.Player(target, {
          videoId,
          host: 'https://www.youtube-nocookie.com',
          width: '100%',
          height: '100%',
          playerVars: {
            playsinline: 1,
            origin: window.location.origin,
            rel: 0,
            start: Math.floor(initialTime),
          },
          events: {
            onReady: () => {
              if (cancelled) return;
              clearTimeout(readyTimeout);
              youtube.current = player!;
              player!.getIframe().title = lesson.title;
              player!.getIframe().setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
              player!.setPlaybackRate(speedRef.current);
              setLoading(false);
              callbacks.current.onReady();
            },
            onStateChange: (event: { data: number }) => {
              if (cancelled) return;
              callbacks.current.onPlaying(event.data === 1);
              if (event.data === 0) callbacks.current.onEnded();
            },
            onError: (event: { data: number }) => {
              clearTimeout(readyTimeout);
              fail(
                errors[event.data] ||
                  'YouTube could not play this video. Try another video or use the demo.',
              );
            },
            onAutoplayBlocked: () => {
              callbacks.current.onPlaying(false);
              fail(
                'Playback was blocked by the browser. Press play directly inside the YouTube video.',
              );
            },
          },
        });
      })
      .catch((error) => fail(error.message));
    return () => {
      cancelled = true;
      clearTimeout(readyTimeout);
      player?.destroy();
      youtube.current = null;
    };
    // Rebuild only on a source change or deliberate retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, attempt]);
  useEffect(() => {
    speedRef.current = speed;
    youtube.current?.setPlaybackRate(speed);
  }, [speed]);
  return (
    <div className="media-frame youtube-frame">
      <div className="youtube-host" ref={host} />
      {loading ? (
        <div className="media-loading">
          <LoaderCircle className="spin" size={22} />
          <span>Getting your player ready…</span>
        </div>
      ) : null}
      {error ? (
        <div className="media-error">
          <p>{error}</p>
          <div>
            <button className="button small-button" onClick={() => setAttempt(attempt + 1)}>
              <RefreshCw size={15} />
              Retry player
            </button>
            <a
              className="button small-button"
              href={`https://www.youtube.com/watch?v=${videoId}`}
              target="_blank"
              rel="noreferrer"
            >
              Open on YouTube
              <ExternalLink size={14} />
            </a>
          </div>
        </div>
      ) : null}
      {overlay}
    </div>
  );
});
