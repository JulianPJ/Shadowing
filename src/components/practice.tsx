'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import demoData from '@/data/demo.json';
import type { Lesson } from '@/lib/types';
import { validateCues } from '@/lib/segmentation';
import { readStorage, loadPreferences, loadLesson, getLiveMedia } from '@/lib/storage';
import { lessonMedia, migrateLesson } from '@/lib/media';
import { Header, Footer, HelpDialog } from './chrome';
import { StudyPlayer, type Session } from './practice/study-player';
import { restoreAccountLesson, subscribeSync, syncStatus } from '@/lib/sync/client';
import { transcriptKey } from '@/lib/transcript';

function openingIndex(lesson: Lesson, lessonId: string, sectionId?: string) {
  if (sectionId) {
    const linked = lesson.segments.findIndex((segment) => segment.id === sectionId);
    if (linked >= 0) return linked;
  }
  const raw = readStorage<number>(`position:${lessonId}`, 0);
  return Number.isInteger(raw) ? Math.max(0, Math.min(raw, lesson.segments.length - 1)) : 0;
}

export function Practice({
  lessonId,
  sectionId,
  expectedTranscript,
}: {
  lessonId: string;
  sectionId?: string;
  expectedTranscript?: string;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [missing, setMissing] = useState(false);
  const [revisionMissing, setRevisionMissing] = useState(false);
  const [help, setHelp] = useState(false);
  /* Browser-only lesson persistence requires a one-time sync after hydration. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let disposed = false;
    const open = async (lesson: Lesson) => {
      if (
        expectedTranscript &&
        ((await transcriptKey(lesson)) !== expectedTranscript ||
          !lesson.segments.some((s) => s.id === sectionId))
      ) {
        if (!disposed) {
          setSession(null);
          setRevisionMissing(true);
          setMissing(true);
        }
        return;
      }
      if (!disposed) {
        setSession({
          lesson,
          index: openingIndex(lesson, lessonId, sectionId),
          preferences: loadPreferences(),
        });
        setMissing(false);
        setRevisionMissing(false);
      }
    };
    const restore = () => {
      if (lessonId === 'demo' || loadLesson(lessonId)) return;
      if (syncStatus().state === 'saved')
        void restoreAccountLesson(lessonId).then((lesson) => {
          if (lesson && !disposed) {
            void open(lesson).catch(() => {
              if (!disposed) setMissing(true);
            });
          }
        });
    };
    const unsubscribe = subscribeSync(restore);
    restore();
    try {
      const lesson = lessonId === 'demo' ? migrateLesson(demoData as Lesson) : loadLesson(lessonId);
      if (!lesson || !lesson.segments?.length) {
        setMissing(true);
        return () => {
          disposed = true;
          unsubscribe();
        };
      }
      if (lessonMedia(lesson).type === 'local') lesson.mediaUrl = getLiveMedia(lesson.id);
      validateCues(lesson.segments);
      void open(lesson).catch(() => {
        if (!disposed) setMissing(true);
      });
    } catch {
      setMissing(true);
    }
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [lessonId, sectionId, expectedTranscript]);
  /* eslint-enable react-hooks/set-state-in-effect */
  return (
    <>
      <Header player onHelp={() => setHelp(true)} />
      {session ? (
        <StudyPlayer key={session.lesson.id} session={session} onHelp={() => setHelp(true)} />
      ) : (
        <main className="empty-screen">
          {missing ? (
            <>
              <span className="eyebrow">A FRESH START</span>
              <h1>
                {revisionMissing
                  ? 'This saved context has changed.'
                  : 'This practice isn’t saved here yet.'}
              </h1>
              <p>
                {revisionMissing
                  ? 'Reattach the original transcript to replay the exact saved section. Your review word and source sentence are still available.'
                  : 'Lessons are saved in the browser where you prepared them. Paste your video link again or explore the sample.'}
              </p>
              <Link className="button primary" href="/">
                Prepare a video <ArrowRight size={16} />
              </Link>
              <Link className="button" href="/practice/demo">
                Try the demo
              </Link>
            </>
          ) : (
            <>
              <LoaderCircle className="spin" size={24} />
              <p>Opening your practice…</p>
            </>
          )}
        </main>
      )}
      <Footer />
      <HelpDialog player open={help} onClose={() => setHelp(false)} />
    </>
  );
}
