'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Lesson, Segment } from '@/lib/types';
import type { PracticeSession } from '@/lib/learner-types';
import { RESUME_WINDOW_MS, createSession, lessonIdentity, recordSignal, resumableSession, type PracticeSignal } from '@/lib/learner-progress';
import { loadLearnerHistory, migrateLearnerHistory, savePracticeSession } from '@/lib/learner-storage';
import { transcriptKey } from '@/lib/quiz';
import { PlaybackActivity, PracticeClock } from '@/lib/practice-clock';
import { PracticeCheckpoint } from '@/lib/practice-checkpoint';
import { progressStorageFailed } from '@/lib/storage';

type Controller = { signal: (segment: Segment, signal: PracticeSignal) => void; position: (segment: Segment) => void; complete: () => void; update: (patch: Parameters<PracticeClock['update']>[1]) => void; response: (seconds: number, speed: number) => void; interact: () => void };
export function usePracticeProgress(lesson: Lesson, state: { playing: boolean; recording: boolean; excluded: boolean; yourTurn: boolean; segment: Segment; speed: number }, readPlaybackTime: () => number) {
  const initial = useRef(lesson);
  const mediaTime = useRef(readPlaybackTime);
  const controller = useRef<Controller | null>(null);
  const pending = useRef<((c: Controller) => void)[]>([]);
  const [warning, setWarning] = useState(false);
  const send = useCallback((action: (c: Controller) => void) => { if (controller.current) action(controller.current); else pending.current.push(action); }, []);
  const signal = useCallback((segment: Segment, kind: PracticeSignal) => send(c => c.signal(segment, kind)), [send]);
  const complete = useCallback(() => send(c => c.complete()), [send]);
  const interact = useCallback(() => send(c => c.interact()), [send]);
  useEffect(() => {
    let disposed = false, timer: ReturnType<typeof setInterval> | undefined, debounce: ReturnType<typeof setTimeout> | undefined;
    let session: PracticeSession | null = null;
    let excluded = false;
    let intendedPlaying = false;
    const playback = new PlaybackActivity();
    const checkpoint = new PracticeCheckpoint(performance.now());
    const clock = new PracticeClock(performance.now());
    const tokenKey = `hibiki:practice-session:${initial.current.id}`;
    const now = () => new Date(Math.max(Date.now(), session ? Date.parse(session.updatedAt) : 0)).toISOString();
    function token(id: string) { try { sessionStorage.setItem(tokenKey, id); } catch { /* Still save local history when sessionStorage is unavailable. */ } }
    function add(seconds: number) {
      if (!session || seconds <= 0) return;
      const timestamp = now(), day = timestamp.slice(0, 10);
      if (Date.parse(timestamp) - Date.parse(session.updatedAt) >= RESUME_WINDOW_MS) renew(timestamp);
      if (!session) return;
      session.activeSeconds += seconds; session.activeByDay[day] = (session.activeByDay[day] ?? 0) + seconds;
      session.updatedAt = timestamp; session.endedAt = null; checkpoint.mark();
    }
    function renew(timestamp: string) {
      if (!session) return;
      session.endedAt = session.updatedAt;
      if (checkpoint.flush(performance.now(), () => savePracticeSession(session!)) === false) setWarning(true);
      session = createSession(session.lesson, timestamp); token(session.id);
    }
    function flush(end = false) {
      if (!session) return;
      add(clock.sample(performance.now()));
      if (end) session.endedAt = session.updatedAt;
      if (checkpoint.flush(performance.now(), () => savePracticeSession(session!)) === false) setWarning(true);
    }
    function touch() {
      if (!session) return;
      const timestamp = now();
      // A long visible idle gap also starts a new session on the next action.
      if (Date.parse(timestamp) - Date.parse(session.updatedAt) >= RESUME_WINDOW_MS) {
        renew(timestamp);
      }
      session.updatedAt = timestamp; session.endedAt = null; checkpoint.mark();
    }
    function soon() { if (!debounce) debounce = setTimeout(() => { debounce = undefined; flush(); }, 1000); }
    const c: Controller = {
      interact: () => { if (!excluded) touch(); add(clock.interact(performance.now())); if (!excluded) soon(); },
      signal: (segment, kind) => { touch(); add(clock.interact(performance.now())); if (session) recordSignal(session, segment, kind, now()); soon(); },
      position: segment => { if (session) session.lastSectionId = segment.id; },
      complete: () => { touch(); if (session) { session.completed = true; session.completedAt = now(); } flush(); },
      update: patch => {
        if (patch.excluded !== undefined) excluded = patch.excluded;
        if (!excluded && (patch.playing || patch.recording)) touch();
        if (patch.playing !== undefined) { intendedPlaying = patch.playing; patch = { ...patch, playing: playback.sample(mediaTime.current(), intendedPlaying) }; }
        add(clock.update(performance.now(), patch));
      },
      response: (seconds, speed) => add(clock.spokenResponse(performance.now(), seconds, speed)),
    };
    function visibility() { add(clock.update(performance.now(), { visible: !document.hidden })); flush(true); }
    function pagehide() { add(clock.update(performance.now(), { visible: false })); flush(true); }
    function pageshow() { add(clock.update(performance.now(), { visible: !document.hidden })); }
    function warningEvent() { setWarning(true); }
    window.addEventListener('hibiki:storage-warning', warningEvent);
    void (async () => {
      await migrateLearnerHistory();
      const key = await transcriptKey(initial.current);
      if (disposed) return;
      const identity = lessonIdentity(initial.current, key); let candidate: string | null = null;
      try { candidate = sessionStorage.getItem(tokenKey); } catch { /* No reload resume token. */ }
      session = structuredClone(resumableSession(loadLearnerHistory(), identity, candidate, now()) ?? createSession(identity, now()));
      token(session.id); controller.current = c;
      c.update({ visible: !document.hidden });
      for (const action of pending.current.splice(0)) action(c);
      if (progressStorageFailed()) setWarning(true);
      timer = setInterval(() => { add(clock.update(performance.now(), { playing: playback.sample(mediaTime.current(), intendedPlaying) })); if (checkpoint.due(performance.now())) flush(); }, 1000);
      document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', pagehide); window.addEventListener('pageshow', pageshow);
    })().catch(() => { if (!disposed) setWarning(true); });
    return () => { disposed = true; flush(true); controller.current = null; clearInterval(timer); clearTimeout(debounce); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', pagehide); window.removeEventListener('pageshow', pageshow); window.removeEventListener('hibiki:storage-warning', warningEvent); };
  }, []);
  useEffect(() => { send(c => c.update({ playing: state.playing, recording: state.recording, excluded: state.excluded })); }, [state.playing, state.recording, state.excluded, send]);
  useEffect(() => { if (state.playing || state.recording) send(c => c.position(state.segment)); }, [state.playing, state.recording, state.segment, send]);
  useEffect(() => { if (state.yourTurn) send(c => c.response(state.segment.end - state.segment.start, state.speed)); }, [state.yourTurn, state.segment.id, state.segment.start, state.segment.end, state.speed, send]);
  return { signal, complete, interact, warning };
}
