'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Lesson } from '@/lib/types';
import { LoaderCircle, ExternalLink, RefreshCw, Music2 } from 'lucide-react';

export interface MediaHandle {
  play(): Promise<void>; pause(): void; seek(time: number): void;
  time(): number; setSpeed(speed: number): void; isPlaying(): boolean;
}
type YouTubePlayer = { playVideo(): void; pauseVideo(): void; seekTo(time: number, allow: boolean): void; getCurrentTime(): number; setPlaybackRate(rate: number): void; getPlayerState(): number; destroy(): void; getIframe(): HTMLIFrameElement };
type YouTubeAPI = { Player: new (target: HTMLElement, options: Record<string, unknown>) => YouTubePlayer };
declare global { interface Window { YT?: YouTubeAPI; onYouTubeIframeAPIReady?: () => void } }
let youtubeAPI: Promise<YouTubeAPI> | undefined;
function loadYouTubeAPI(): Promise<YouTubeAPI> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeAPI) return youtubeAPI;
  youtubeAPI = new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => { youtubeAPI = undefined; reject(new Error('YouTube took too long to load. Check your connection or content blocker.')); }, 15000);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { window.clearTimeout(timeout); previous?.(); if (window.YT) resolve(window.YT); };
    let script = document.getElementById('youtube-iframe-api') as HTMLScriptElement | null;
    if (!script) { script = document.createElement('script'); script.id = 'youtube-iframe-api'; script.src = 'https://www.youtube.com/iframe_api'; script.async = true; document.head.appendChild(script); }
    script.onerror = () => { window.clearTimeout(timeout); script?.remove(); youtubeAPI = undefined; reject(new Error('YouTube could not load. Check your connection or content blocker.')); };
  });
  return youtubeAPI;
}
const errors: Record<number, string> = { 2: 'The video link is invalid.', 5: 'This browser could not play the YouTube video.', 100: 'This video is private, removed, or unavailable.', 101: 'This creator does not allow embedded playback.', 150: 'This creator does not allow embedded playback.', 153: 'YouTube could not verify this embedded player. Open the app in a regular browser tab.' };

export const MediaPlayer = forwardRef<MediaHandle, { lesson: Lesson; speed: number; initialTime: number; onReady: () => void; onPlaying: (playing: boolean) => void; onEnded: () => void; onError: (message: string) => void }>(function MediaPlayer({ lesson, speed, initialTime, onReady, onPlaying, onEnded, onError }, ref) {
  const video = useRef<HTMLVideoElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const youtube = useRef<YouTubePlayer | null>(null);
  const callbacks = useRef({ onReady, onPlaying, onEnded, onError });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { callbacks.current = { onReady, onPlaying, onEnded, onError }; }, [onReady, onPlaying, onEnded, onError]);
  useImperativeHandle(ref, () => ({
    async play() { if (youtube.current) youtube.current.playVideo(); else if (video.current) await video.current.play(); },
    pause() { youtube.current?.pauseVideo(); video.current?.pause(); },
    seek(time) { if (youtube.current) youtube.current.seekTo(time, true); else if (video.current) video.current.currentTime = time; },
    time() { return youtube.current?.getCurrentTime() ?? video.current?.currentTime ?? 0; },
    setSpeed(rate) { youtube.current?.setPlaybackRate(rate); if (video.current) video.current.playbackRate = rate; },
    isPlaying() { return youtube.current ? youtube.current.getPlayerState() === 1 : !!video.current && !video.current.paused; },
  }), []);
  useEffect(() => {
    if (lesson.source !== 'youtube') return;
    let cancelled = false; let player: YouTubePlayer | undefined;
    let readyTimeout: ReturnType<typeof setTimeout>;
    setLoading(true); setError('');
    const fail = (message: string) => { if (!cancelled) { setError(message); setLoading(false); callbacks.current.onError(message); } };
    loadYouTubeAPI().then(api => {
      if (cancelled || !host.current) return;
      const target = document.createElement('div'); host.current.replaceChildren(target);
      readyTimeout = setTimeout(() => fail('YouTube hasn’t connected. Check your connection, then retry the player.'), 18000);
      player = new api.Player(target, { videoId: lesson.videoId, host: 'https://www.youtube-nocookie.com', width: '100%', height: '100%', playerVars: { playsinline: 1, origin: window.location.origin, rel: 0, start: Math.floor(initialTime) }, events: {
        onReady: () => { if (cancelled) return; clearTimeout(readyTimeout); youtube.current = player!; player!.getIframe().title = lesson.title; player!.getIframe().setAttribute('referrerpolicy', 'strict-origin-when-cross-origin'); setLoading(false); callbacks.current.onReady(); },
        onStateChange: (event: { data: number }) => { if (cancelled) return; callbacks.current.onPlaying(event.data === 1); if (event.data === 0) callbacks.current.onEnded(); },
        onError: (event: { data: number }) => { clearTimeout(readyTimeout); fail(errors[event.data] || 'YouTube could not play this video. Try another video or use the demo.'); },
        onAutoplayBlocked: () => { callbacks.current.onPlaying(false); fail('Playback was blocked by the browser. Press play directly inside the YouTube video.'); },
      } });
    }).catch(error => fail(error.message));
    return () => { cancelled = true; clearTimeout(readyTimeout); player?.destroy(); youtube.current = null; };
  // The adapter is rebuilt only when its actual source changes; speed is handled separately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.videoId, lesson.source, attempt]);
  useEffect(() => { youtube.current?.setPlaybackRate(speed); if (video.current) video.current.playbackRate = speed; }, [speed]);
  return <div className={`media-frame ${lesson.source === 'youtube' ? 'youtube-frame' : ''}`}>
    {lesson.source === 'youtube' ? <div className="youtube-host" ref={host} /> : lesson.mediaUrl ? <video ref={video} src={lesson.mediaUrl} poster="/demo-poster.svg" playsInline controls preload="metadata" onLoadedMetadata={() => { if (video.current) { video.current.currentTime = initialTime; video.current.playbackRate = speed; } setLoading(false); callbacks.current.onReady(); }} onPlay={() => callbacks.current.onPlaying(true)} onPause={() => callbacks.current.onPlaying(false)} onEnded={() => callbacks.current.onEnded()} onError={() => { const message = 'This media could not be played. Try an MP4, WebM, MP3, or WAV file supported by your browser.'; setError(message); setLoading(false); callbacks.current.onError(message); }}><track kind="captions" src={lesson.source === 'demo' ? '/demo.vtt' : undefined} srcLang="ja" label="Japanese" /></video> : <div className="missing-media"><Music2 size={36} /><p>Reattach your media to continue.</p></div>}
    {loading && lesson.mediaUrl || loading && lesson.source === 'youtube' ? <div className="media-loading"><LoaderCircle className="spin" size={22} /><span>Getting your player ready…</span></div> : null}
    {error ? <div className="media-error"><p>{error}</p>{lesson.source === 'youtube' ? <div><button className="button small-button" onClick={() => setAttempt(attempt + 1)}><RefreshCw size={15} />Retry player</button><a className="button small-button" href={`https://www.youtube.com/watch?v=${lesson.videoId}`} target="_blank" rel="noreferrer">Open on YouTube<ExternalLink size={14} /></a></div> : null}</div> : null}
  </div>;
});
