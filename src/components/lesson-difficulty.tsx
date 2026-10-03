'use client';
import { memo, useEffect, useRef, useState } from 'react';
import { calculateSpeechSpeed, validateDifficultyAnalysis, validateDifficultyLesson } from '@/lib/difficulty';
import { object, transcriptRevision } from '@/lib/quiz';
import { loadDifficulty, saveDifficulty } from '@/lib/storage';
import { timestamp } from '@/lib/youtube';
import type { ContentDifficultyAnalysis, Lesson } from '@/lib/types';

export const LessonDifficulty = memo(function LessonDifficulty({ lesson, onWaitingChange }: { lesson: Lesson; onWaitingChange?: (waiting: boolean) => void }) {
  // Transcript edits discard in-memory results and cancel obsolete requests too.
  return <DifficultyCard key={`${lesson.id}:${transcriptRevision(lesson)}`} lesson={lesson} onWaitingChange={onWaitingChange} />;
});
function DifficultyCard({ lesson, onWaitingChange }: { lesson: Lesson; onWaitingChange?: (waiting: boolean) => void }) {
  const [analysis, setAnalysis] = useState<ContentDifficultyAnalysis | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [storageWarning, setStorageWarning] = useState(false);
  const [checkingCache, setCheckingCache] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const busy = useRef(false);
  // The parent key owns transcript invalidation. Media reattachment must not
  // cancel an otherwise valid pending analysis or reload this cache.
  const initialLesson = useRef(lesson);
  const speech = analysis?.speechSpeed || calculateSpeechSpeed(lesson.segments);
  const insufficient = speech.japaneseCharacters < 40 || lesson.segments.length < 2;
  useEffect(() => {
    let active = true;
    void loadDifficulty(initialLesson.current).then(cached => { if (active) { setAnalysis(cached); setCheckingCache(false); } });
    return () => { active = false; abort.current?.abort(); };
  }, []);
  async function analyze() {
    if (busy.current || checkingCache || analysis) return;
    busy.current = true; setLoading(true); setError(''); setOpen(true); onWaitingChange?.(true);
    const controller = new AbortController(); abort.current = controller;
    const unavailable = 'Difficulty analysis is unavailable right now. Please try again.';
    try {
      let input;
      try { input = validateDifficultyLesson(lesson); }
      catch { throw new Error('This transcript cannot support difficulty analysis. You can keep practicing.'); }
      const response = await fetch('/api/difficulty', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]) });
      const data = object(await response.json());
      if (!response.ok) throw new Error(data.code === 'insufficient-transcript' ? 'There is not enough Japanese transcript for a useful estimate.' : data.code === 'malformed' ? 'We could not make a reliable difficulty estimate. Please try again.' : unavailable);
      let next;
      try { next = await validateDifficultyAnalysis(data.analysis, input); }
      catch { throw new Error('We could not make a reliable difficulty estimate. Please try again.'); }
      if (controller.signal.aborted) return;
      setStorageWarning(!await saveDifficulty(next, input));
      if (!controller.signal.aborted) setAnalysis(next);
    } catch (error) {
      // Only our own messages reach the UI, never arbitrary upstream diagnostics.
      if (!controller.signal.aborted) setError(error instanceof Error && ['There is not enough', 'This transcript', 'We could not', 'Difficulty analysis is unavailable'].some(prefix => error.message.startsWith(prefix)) ? error.message : unavailable);
    } finally { busy.current = false; if (!controller.signal.aborted) { setLoading(false); onWaitingChange?.(false); } }
  }
  const dimensions = analysis ? [
    { title: 'Vocabulary', value: analysis.vocabulary },
    { title: 'Grammar', value: analysis.grammar },
    { title: 'Conversation', value: analysis.conversationalComplexity },
  ] : [];
  return <section className="difficulty-card" aria-labelledby="difficulty-title" data-testid="lesson-difficulty">
    <div className="difficulty-heading"><h2 id="difficulty-title">Estimated content difficulty</h2><span className="small muted">Content only</span></div>
    {analysis ? <dl className="difficulty-summary">
      <div><dt>Approx. level</dt><dd>{analysis.overall.label.replace('Approximately ', '')}</dd></div>
      {dimensions.slice(0, 2).map(d => <div key={d.title}><dt>{d.title}</dt><dd>{d.value.label}</dd></div>)}
      <div><dt>Speech</dt><dd>{speech.label}</dd></div>
      <div><dt>Conversation</dt><dd>{analysis.conversationalComplexity.label}</dd></div>
    </dl> : <p className="difficulty-pace"><span>Speech · </span>{speech.label}<span className="small muted"> · Estimated from captions</span></p>}
    {analysis ? <button className="text-button difficulty-toggle" aria-expanded={open} aria-controls="difficulty-details" onClick={() => setOpen(!open)}>{open ? 'Hide difficulty details' : 'Show difficulty details'}</button> : <>
      <p className="small muted">Estimate the language demands when it’s useful. This is an approximate guide, not an official JLPT classification.</p>
      <button className="button difficulty-toggle" disabled={checkingCache || loading || insufficient} onClick={() => void analyze()}>{loading ? 'Estimating difficulty…' : error ? 'Retry difficulty analysis' : 'Estimate difficulty'}</button>
      {insufficient ? <p className="small muted">Not enough Japanese transcript for a useful estimate.</p> : <p className="small muted">Estimating uses Japanese transcript samples. The result stays on this device.</p>}
    </>}
    {loading ? <p role="status" className="small muted">Estimating the language demands… You can keep practicing.</p> : null}
    {error ? <p role="alert">{error} Your practice and comprehension check remain available.</p> : null}
    {analysis && open ? <div id="difficulty-details" className="difficulty-details">
      <h3>{analysis.overall.label}</h3><p>{analysis.overall.explanation}</p>
      <p className="small muted">{analysis.overall.confidence[0].toUpperCase() + analysis.overall.confidence.slice(1)} confidence · An estimate, not an official JLPT classification.</p>
      {dimensions.map(d => <div className="difficulty-dimension" key={d.title}><h3>{d.title} · {d.value.label}</h3><p>{d.value.explanation}</p><ul>{d.value.examples.map(e => <li key={`${e.segmentId}:${e.quote}`}><q lang="ja">{e.quote}</q><span className="small muted"> {timestamp(e.start)}–{timestamp(e.end)} · Section timing</span><p className="small">{e.explanation}</p></li>)}</ul></div>)}
      <div className="difficulty-dimension"><h3>Speech · {speech.label}</h3><p>{speech.explanation}</p>{speech.value !== null ? <p className="small muted">About {Math.round(speech.value)} Japanese characters/min · Original playback speed</p> : null}</div>
      <p className="small muted">{analysis.coverage.sampledSegments === analysis.coverage.totalSegments && analysis.coverage.sampledCharacters === analysis.coverage.totalCharacters ? 'Based on the full transcript.' : `Based on ${analysis.coverage.sampledSegments} of ${analysis.coverage.totalSegments} sections sampled across the lesson; some details may be missed.`}</p>
      {storageWarning ? <p className="small" role="status">This browser could not save the estimate. It is available for this visit.</p> : null}
    </div> : null}
  </section>;
}
