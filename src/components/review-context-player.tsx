'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import demoData from '@/data/demo.json';
import { loadLesson, getLiveMedia } from '@/lib/storage/lessons';
import { lessonMedia, migrateLesson } from '@/lib/media';
import { transcriptKey } from '@/lib/transcript';
import { restoreAccountLesson } from '@/lib/sync/client';
import { reviewContextHref } from '@/lib/dictionary/replay';
import type { DictionaryEntry } from '@/lib/dictionary/types';
import type { Lesson } from '@/lib/types';
import { MediaPlayer, type MediaHandle } from './media-player';

/** Uses the same authorized adapters as practice without mounting a second study session. */
export function ReviewContextPlayer({
  entry,
  onClose,
}: {
  entry: DictionaryEntry;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<Lesson | null>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const media = useRef<MediaHandle>(null);
  const { start, end } = entry.source;
  useEffect(() => {
    let active = true;
    async function open() {
      const lesson =
        entry.source.lessonId === 'demo'
          ? migrateLesson(demoData as Lesson)
          : (loadLesson(entry.source.lessonId) ??
            (await restoreAccountLesson(entry.source.lessonId)));
      if (!lesson)
        throw new Error(
          'This lesson is not available on this device. Open the full lesson to prepare or reattach it.',
        );
      const segment = lesson.segments.find((s) => s.id === entry.source.segmentId);
      if (
        (await transcriptKey(lesson)) !== entry.source.transcriptKey ||
        !segment ||
        segment.japanese !== entry.sourceSentence ||
        segment.start !== start ||
        segment.end !== end
      )
        throw new Error(
          'This saved context has changed. Reattach the original transcript to replay the exact section.',
        );
      if (lessonMedia(lesson).type === 'local') {
        lesson.mediaUrl = getLiveMedia(lesson.id);
        if (!lesson.mediaUrl)
          throw new Error('Reattach your local media in the full lesson to play this section.');
      }
      if (active) setLoaded(lesson);
    }
    void open().catch((e) => {
      if (active) setError((e as Error).message);
    });
    const handle = media;
    const visibility = () => {
      if (document.hidden) handle.current?.pause();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      active = false;
      handle.current?.pause();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [entry, start, end]);
  useEffect(() => {
    // Capture the mounted handle: React clears refs before passive unmount cleanup.
    const player = media.current;
    return () => player?.pause();
  }, [loaded]);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      if (media.current && media.current.time() < start) media.current.seek(start);
      if (media.current && media.current.time() >= end - 0.04) {
        media.current.pause();
        setPlaying(false);
      }
    }, 80);
    return () => window.clearInterval(timer);
  }, [playing, start, end]);
  async function replay() {
    if (!media.current || !ready) return;
    media.current.seek(start);
    try {
      await media.current.play();
      setError('');
    } catch {
      setError('Press Play section again, or use the player controls to start audio.');
    }
  }
  return (
    <section className="review-context" aria-label="Saved section playback">
      <div className="review-context-toolbar">
        <strong>{entry.source.lessonTitle}</strong>
        <button
          className="text-button"
          onClick={() => {
            media.current?.pause();
            onClose();
          }}
        >
          Minimise context
        </button>
      </div>
      {loaded ? (
        <MediaPlayer
          ref={media}
          lesson={loaded}
          speed={1}
          initialTime={start}
          onReady={() => setReady(true)}
          onPlaying={(value) => {
            if (
              value &&
              media.current &&
              (media.current.time() < start || media.current.time() >= end)
            )
              media.current.seek(start);
            setPlaying(value);
          }}
          onEnded={() => setPlaying(false)}
          onError={setError}
        />
      ) : !error ? (
        <p role="status">Opening this saved section…</p>
      ) : null}
      {loaded ? (
        <button className="button" disabled={!ready} onClick={() => void replay()}>
          Play section
        </button>
      ) : null}
      <p className="small muted">
        Playback pauses at the end of the saved section. Minimising pauses audio.
      </p>
      {error ? <p role="status">{error}</p> : null}
      <Link
        className="text-button"
        href={reviewContextHref(entry)}
        target="_blank"
        rel="noreferrer"
      >
        Open full lesson ↗
      </Link>
    </section>
  );
}
