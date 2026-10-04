'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type Player from '@vimeo/player';
import { ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import { lessonMedia } from '@/lib/media';
import { VimeoControls } from '@/lib/vimeo-controls';
import type { MediaHandle, MediaPlayerProps } from './media-player';

export const VimeoMedia = forwardRef<MediaHandle, MediaPlayerProps>(function VimeoMedia(
  { lesson, initialTime, speed, onReady, onPlaying, onEnded, onError },
  ref,
) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const controls = useRef<VimeoControls | null>(null);
  const callbacks = useRef({ onReady, onPlaying, onEnded, onError });
  const speedRef = useRef(speed);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rateUnavailable, setRateUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const source = lessonMedia(lesson);
  const url = source.type === 'vimeo' ? source.canonicalUrl : '';
  useEffect(() => {
    callbacks.current = { onReady, onPlaying, onEnded, onError };
  }, [onReady, onPlaying, onEnded, onError]);
  useImperativeHandle(
    ref,
    () => ({
      async play() {
        await controls.current?.play();
      },
      pause() {
        controls.current?.pause();
      },
      seek(time) {
        controls.current?.seek(time);
      },
      time() {
        return controls.current?.time() ?? 0;
      },
      setSpeed(rate) {
        controls.current?.setSpeed(rate);
      },
      isPlaying() {
        return controls.current?.isPlaying() ?? false;
      },
    }),
    [],
  );
  useEffect(() => {
    let cancelled = false;
    let failed = false;
    let player: Player | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    setLoading(true);
    setError('');
    setRateUnavailable(false);
    const fail = (
      message = 'Vimeo could not connect or control this video. It may be private or restrict embedding. Try another link or import your own media.',
    ) => {
      if (cancelled || failed) return;
      failed = true;
      clearInterval(poll);
      controls.current?.pause();
      controls.current?.playingState(false);
      setLoading(false);
      setError(message);
      callbacks.current.onPlaying(false);
      callbacks.current.onError(message);
    };
    const timeout = setTimeout(() => fail(), 18000);
    import('@vimeo/player')
      .then(async ({ default: VimeoPlayer }) => {
        if (cancelled || !iframe.current) return;
        player = new VimeoPlayer(iframe.current);
        const adapter = new VimeoControls(player, () => fail(), setRateUnavailable);
        controls.current = adapter;
        player.on('playing', () => {
          if (!cancelled && !failed) {
            adapter.playingState(true);
            callbacks.current.onPlaying(true);
          }
        });
        player.on('pause', () => {
          if (!cancelled) {
            adapter.playingState(false);
            callbacks.current.onPlaying(false);
          }
        });
        player.on('ended', () => {
          if (!cancelled) {
            adapter.playingState(false);
            callbacks.current.onPlaying(false);
            callbacks.current.onEnded();
          }
        });
        player.on('error', (error) => {
          if (error.method !== 'setPlaybackRate') fail();
        });
        await player.ready();
        const duration = await player.getDuration();
        if (!Number.isFinite(duration) || duration <= 0) {
          fail('This Vimeo video does not expose a seekable recording. Try another video.');
          return;
        }
        await player.setCurrentTime(Math.min(initialTime, duration));
        if (cancelled || failed) return;
        await adapter.poll();
        if (cancelled || failed) return;
        adapter.setSpeed(speedRef.current);
        clearTimeout(timeout);
        setLoading(false);
        callbacks.current.onReady();
        poll = setInterval(() => {
          void adapter.poll();
        }, 50);
      })
      .catch(() => fail());
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      clearInterval(poll);
      controls.current?.dispose();
      controls.current = null;
      void player?.destroy().catch(() => {});
    };
    // Keep provider state stable while Practice rerenders; callbacks/speed have their own refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, attempt]);
  useEffect(() => {
    speedRef.current = speed;
    controls.current?.setSpeed(speed);
  }, [speed]);
  return (
    <div className="media-frame youtube-frame">
      <iframe
        key={attempt}
        ref={iframe}
        src={`${url}${url.includes('?') ? '&' : '?'}playsinline=1&dnt=1`}
        title={lesson.title}
        allow="autoplay; fullscreen; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
        className="vimeo-host"
      />
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
            <a className="button small-button" href={url} target="_blank" rel="noreferrer">
              Open on Vimeo
              <ExternalLink size={14} />
            </a>
          </div>
        </div>
      ) : null}
      {rateUnavailable && !error ? (
        <p className="media-source-link small" role="status">
          Vimeo has not allowed this speed change for this video. Playback uses the provider’s
          current speed.
        </p>
      ) : null}
    </div>
  );
});
