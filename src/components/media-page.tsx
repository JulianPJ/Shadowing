'use client';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ExternalLink, LoaderCircle } from 'lucide-react';
import type { PageMediaSource } from '@/lib/types';
import { lessonMedia } from '@/lib/media';
import {
  bridgeRequest,
  bridgeVersion,
  onBridgeEvent,
  type PageMediaState,
} from '@/lib/extension/bridge';
import type { MediaHandle, MediaPlayerProps } from './media-player';

type Connection =
  { status: 'connecting' | 'no-extension' | 'waiting' } | { status: 'ready'; tabId: number };

/**
 * A video on another web page, played in its own tab through Hibiki Bridge. Hibiki keeps time
 * from the page's reports and mirrors the current line onto the original video.
 */
export const PageMedia = forwardRef<MediaHandle, MediaPlayerProps & { caption?: string }>(
  function PageMedia(
    { lesson, speed, initialTime, onReady, onPlaying, onEnded, onError, overlay, caption },
    ref,
  ) {
    const source = lessonMedia(lesson) as PageMediaSource;
    const [connection, setConnection] = useState<Connection>({ status: 'connecting' });
    const tab = connection.status === 'ready' ? connection.tabId : null;
    const clock = useRef({ time: initialTime, at: 0, paused: true, rate: 1 });
    const callbacks = useRef({ onReady, onPlaying, onEnded, onError });
    useEffect(() => {
      callbacks.current = { onReady, onPlaying, onEnded, onError };
    });
    const tabRef = useRef<number | null>(null);
    const speedRef = useRef(speed);
    const startAt = useRef(initialTime);
    const now = () => {
      const { time, at, paused, rate } = clock.current;
      return paused ? time : time + ((performance.now() - at) / 1000) * rate;
    };

    const apply = useCallback((state: PageMediaState) => {
      const wasPaused = clock.current.paused;
      clock.current = {
        time: state.currentTime,
        at: performance.now(),
        paused: state.paused,
        rate: state.playbackRate,
      };
      if (wasPaused !== state.paused) callbacks.current.onPlaying(!state.paused);
      if (state.ended) callbacks.current.onEnded();
    }, []);

    const command = useCallback(
      async (action: string, value?: unknown) => {
        const tabId = tabRef.current;
        if (tabId === null) throw new Error('Connect the video page with Hibiki Bridge first.');
        const state = await bridgeRequest<PageMediaState>('media', { tabId, action, value });
        apply(state);
        return state;
      },
      [apply],
    );

    const connected = useCallback(
      async (tabId: number, state?: PageMediaState) => {
        tabRef.current = tabId;
        setConnection({ status: 'ready', tabId });
        if (state) apply(state);
        await command('rate', speedRef.current).catch(() => {});
        if (Math.abs((state?.currentTime ?? 0) - startAt.current) > 0.5)
          await command('seek', startAt.current).catch(() => {});
        callbacks.current.onReady();
      },
      [apply, command],
    );

    useEffect(() => {
      let active = true;
      const stop = onBridgeEvent((event) => {
        if (event.event === 'tab-connected' && tabRef.current === null) {
          try {
            const url = new URL(event.data.pageUrl);
            url.hash = '';
            if (url.href === source.canonicalUrl) void connected(event.tabId);
          } catch {
            /* Not this lesson's page. */
          }
          return;
        }
        if (event.tabId !== tabRef.current) return;
        if (event.event === 'media-state') apply(event.data);
        if (event.event === 'tab-closed') {
          tabRef.current = null;
          setConnection({ status: 'waiting' });
          callbacks.current.onPlaying(false);
          callbacks.current.onError(
            'The video page was closed or navigated away. Open it again and click Hibiki Bridge.',
          );
        }
      });
      void (async () => {
        if (!(await bridgeVersion())) {
          if (active) setConnection({ status: 'no-extension' });
          return;
        }
        const result = await bridgeRequest<{ tabId: number | null; state?: PageMediaState }>(
          'connect',
          { pageUrl: source.canonicalUrl },
        ).catch(() => ({ tabId: null }));
        if (!active) return;
        if (result.tabId === null) setConnection({ status: 'waiting' });
        else await connected(result.tabId, 'state' in result ? result.state : undefined);
      })();
      return () => {
        active = false;
        stop();
      };
    }, [source.canonicalUrl, apply, connected]);

    useEffect(() => {
      speedRef.current = speed;
      if (tabRef.current !== null) void command('rate', speed).catch(() => {});
    }, [speed, command]);

    // Hibiki's current line over the original video.
    useEffect(() => {
      if (tab === null) return;
      void bridgeRequest('subtitle', { tabId: tab, text: caption ?? '' }).catch(() => {});
    }, [tab, caption]);
    useEffect(
      () => () => {
        if (tabRef.current !== null)
          void bridgeRequest('subtitle', { tabId: tabRef.current, text: '' }).catch(() => {});
      },
      [],
    );

    useImperativeHandle(
      ref,
      () => ({
        async play() {
          await command('play');
        },
        pause() {
          clock.current = { ...clock.current, time: now(), at: performance.now(), paused: true };
          void command('pause').catch(() => {});
        },
        seek(time: number) {
          clock.current = { ...clock.current, time, at: performance.now() };
          void command('seek', time).catch(() => {});
        },
        time: now,
        setSpeed(value: number) {
          void command('rate', value).catch(() => {});
        },
        isPlaying() {
          return !clock.current.paused;
        },
      }),
      [command],
    );

    const host = new URL(source.canonicalUrl).hostname;
    return (
      <div className="media-frame page-frame">
        <div className="page-media">
          {connection.status === 'connecting' ? (
            <p>
              <LoaderCircle className="spin" size={18} /> Connecting to the video page…
            </p>
          ) : connection.status === 'no-extension' ? (
            <p>
              This lesson plays a video from {host}. Install Hibiki Bridge, then open the page and
              click the extension.
            </p>
          ) : connection.status === 'waiting' ? (
            <>
              <p>
                Open the video on {host}, click Hibiki Bridge and choose “Connect to my Hibiki
                lesson”.
              </p>
              <a className="button" href={source.canonicalUrl} target="_blank" rel="noreferrer">
                Open the page <ExternalLink size={14} />
              </a>
            </>
          ) : (
            <>
              <p>Playing in its own tab on {host}.</p>
              <button
                className="button"
                onClick={() => void bridgeRequest('focus', { tabId: tab })}
              >
                Show video tab
              </button>
            </>
          )}
        </div>
        {overlay}
      </div>
    );
  },
);
