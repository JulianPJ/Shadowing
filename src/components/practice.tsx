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
export function Practice({ lessonId }: { lessonId: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [missing, setMissing] = useState(false);
  const [help, setHelp] = useState(false);
  /* Browser-only lesson persistence requires a one-time sync after hydration. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let disposed = false;
    const restore = () => {
      if (lessonId === 'demo' || loadLesson(lessonId)) return;
      if (syncStatus().state === 'saved')
        void restoreAccountLesson(lessonId).then((lesson) => {
          if (lesson && !disposed) {
            setSession({
              lesson,
              index: readStorage(`position:${lessonId}`, 0),
              preferences: loadPreferences(),
            });
            setMissing(false);
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
      const rawIndex = readStorage<number>(`position:${lessonId}`, 0);
      const index = Number.isInteger(rawIndex)
        ? Math.max(0, Math.min(rawIndex, lesson.segments.length - 1))
        : 0;
      const preferences = loadPreferences();
      setSession({ lesson, index, preferences });
    } catch {
      setMissing(true);
    }
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [lessonId]);
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
              <h1>This practice isn’t saved here yet.</h1>
              <p>
                Lessons are saved in the browser where you prepared them. Paste your video link
                again or explore the sample.
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
