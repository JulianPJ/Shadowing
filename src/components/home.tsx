'use client';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, ArrowUpRight, Headphones, Mic, Repeat2, SquarePlay, Upload, Play, Check, LoaderCircle, X, Clock3 } from 'lucide-react';
import { Header, Footer, HelpDialog } from './chrome';
import { ImportDialog } from './import-dialog';
import { sourceLabel } from '@/lib/media';
import { resolveMediaLink } from '@/lib/media-discovery';
import { needsUserTranscript } from '@/lib/linked-transcripts';
import { recentLessons, saveLesson, type StudyRecord } from '@/lib/storage';
import type { Lesson, ResolvedMedia } from '@/lib/types';

export function Home() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [help, setHelp] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [error, setError] = useState('');
  const [resolved, setResolved] = useState<ResolvedMedia | undefined>();
  const [needsTranscript, setNeedsTranscript] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('identify');
  const [message, setMessage] = useState('Finding your video…');
  const [recent, setRecent] = useState<StudyRecord[]>([]);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    const history = recentLessons();
    // Browser-only persistence is read once after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (Array.isArray(history)) setRecent(history.filter(item => item?.lesson?.segments?.length).slice(0, 3));
    return () => abort.current?.abort();
  }, []);
  function openLesson(lesson: Lesson) { saveLesson(lesson, 0); router.push(`/practice/${lesson.id}`); }
  async function prepare(event: React.FormEvent) {
    event.preventDefault(); setError(''); setResolved(undefined); setNeedsTranscript(false);
    const controller = new AbortController(); abort.current = controller;
    setBusy(true); setStage('identify'); setMessage('Finding your video…');
    try {
      const selected = await resolveMediaLink(url, controller.signal);
      if (controller.signal.aborted) return;
      setResolved(selected);
      if (selected.media.type !== 'youtube') {
        setNeedsTranscript(true); setMessage('No Japanese subtitles were found automatically. Add your own transcript to continue.'); setImportOpen(true); return;
      }
      const response = await fetch('/api/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: selected.media.canonicalUrl }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]) });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error || 'We couldn’t prepare this video. Try again.'); }
      if (!response.body) throw new Error('The connection ended unexpectedly. Please try again.');
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const data = JSON.parse(line);
          if (controller.signal.aborted) return;
          if (data.resolved) setResolved({ ...data.resolved, originalUrl: selected.originalUrl });
          if (data.error) {
            if (needsUserTranscript(data.code)) { setNeedsTranscript(true); setMessage(data.error); setImportOpen(true); return; }
            throw new Error(data.error);
          }
          if (data.stage) setStage(data.stage);
          if (data.message) setMessage(data.message);
          if (data.lesson) { finished = true; openLesson(data.lesson); }
        }
        if (done) break;
      }
      if (!finished) throw new Error('The connection ended before the transcript was ready. Please try again.');
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error && error.name !== 'TimeoutError' ? error.message : 'The connection took too long. Try again, import subtitles, or use the demo.');
    } finally { if (abort.current === controller) setBusy(false); }
  }
  const stages = ['identify', 'captions', 'segment'];
  return <><Header onHelp={() => setHelp(true)} /><main className="home-main">
    <section className="hero"><div className="hero-intro"><span className="hero-tag"><span className="tiny-dot" /> A little Japanese. A little closer.</span>
      <h1>Find your rhythm.<br /><em>Make Japanese your own.</em></h1><p className="hero-description">Turn the videos you love into speaking practice.<br className="desktop-break" /> Listen to a little. Pause. Say it back. Find your voice.</p>
    </div>
    <div className="start-card"><form onSubmit={prepare}><label className="input-label" htmlFor="video-url">Paste a Japanese video link</label><div className="url-input-wrap"><SquarePlay className="youtube-icon" size={23} strokeWidth={1.6} /><input id="video-url" aria-describedby="url-hint" type="text" inputMode="url" value={url} onChange={event => { setUrl(event.target.value); setResolved(undefined); setNeedsTranscript(false); }} placeholder="https://..." disabled={busy} required maxLength={2000} /><button className="button primary start-button" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <>Start shadowing<ArrowRight size={18} /></>}</button></div></form>
      <div className="input-meta"><span id="url-hint"><Check size={14} /> No account. Just your curiosity.</span><button className="text-button" onClick={() => setImportOpen(true)}><Upload size={14} /> Import media or subtitles</button></div>
      {busy ? <div className="preparing" role="status"><div className="prepare-top"><span><LoaderCircle className="spin" size={15} />{message}</span><button className="icon-button" aria-label="Cancel preparation" onClick={() => { abort.current?.abort(); setBusy(false); }}><X size={16} /></button></div><div className="prepare-stages">{['Find video', 'Read Japanese', 'Shape your practice'].map((label, index) => <span className={stages.indexOf(stage) >= index ? 'active' : ''} key={label}><span>{stages.indexOf(stage) > index ? <Check size={11} /> : index + 1}</span>{label}</span>)}</div></div> : null}
      {needsTranscript ? <div role="status" className="error-message"><p>{message}</p><button className="text-button" onClick={() => setImportOpen(true)}>Upload your own transcript <ArrowRight size={14} /></button></div> : null}
      {error ? <div role="alert" className="error-message"><p>{error}</p><div><button className="text-button" onClick={() => setImportOpen(true)}>Import a transcript <ArrowRight size={14} /></button><Link className="text-button" href="/practice/demo">Try the demo <ArrowRight size={14} /></Link></div></div> : null}
    </div></section>
    <section className="demo-section" aria-labelledby="demo-title"><div className="demo-art"><Image src="/demo-poster.svg" alt="An illustrated Japanese mountain landscape at sunrise" fill sizes="(max-width: 700px) 100vw, 470px" priority /><Link href="/practice/demo" className="demo-art-play" aria-label="Play the demo lesson"><Play size={24} fill="currentColor" /></Link><span className="art-label">THE LISTENING STUDIO</span></div><div className="demo-copy"><span className="eyebrow"><span className="tiny-dot" /> START SOMEWHERE SIMPLE</span><h2 id="demo-title">A quiet morning.<br />Your first conversation.</h2><p>Ease into the rhythm with a gentle Japanese story about everyday life. Fourteen small moments to listen, repeat, and make your own.</p><div className="lesson-tags"><span><Headphones size={14} /> Beginner friendly</span><span><Clock3 size={14} /> About 1 minute</span><span>14 sections</span></div><Link className="button demo-button" href="/practice/demo">Try the demo<ArrowUpRight size={18} /></Link><span className="demo-note">Built-in sample · Japanese synthetic voice · no setup</span></div></section>
    {recent.length ? <section className="recent-section"><div className="section-heading"><h2>Pick up where you left off</h2><span className="small muted">Saved on this device</span></div><div className="recent-grid">{recent.map(item => <Link href={`/practice/${item.lesson.id}`} className="recent-card" key={item.lesson.id}><span className="recent-icon"><Headphones size={20} /></span><div><strong>{item.lesson.title}</strong><span>Section {item.index + 1} of {item.lesson.segments.length} · {sourceLabel(item.lesson)}</span></div><ArrowUpRight size={17} /></Link>)}</div></section> : null}
    <section className="rhythm-section"><div className="section-heading"><span className="eyebrow">LESS RUSH. MORE RHYTHM.</span><span className="small muted">A practice that leaves room for you.</span></div><div className="rhythm-grid"><div><span className="step-icon"><Headphones size={23} /></span><span className="step-number">01</span><h3>Listen to a little.</h3><p>Short, natural sections help you hear the details. Slow it down if you need to.</p></div><div><span className="step-icon"><Mic size={23} /></span><span className="step-number">02</span><h3>Take your space.</h3><p>Playback pauses for you. Say it aloud, record your voice, or simply try again.</p></div><div><span className="step-icon"><Repeat2 size={23} /></span><span className="step-number">03</span><h3>Let it become yours.</h3><p>Replay the rhythm. Reveal a translation when you need one. Move at your own pace.</p></div></div></section>
    <div className="home-signoff"><span lang="ja">少しずつ、自分の声に。</span><p>Little by little, in your own voice.</p></div>
  </main><Footer /><HelpDialog open={help} onClose={() => setHelp(false)} /><ImportDialog key={importOpen ? `${url}:${resolved?.media.contentKey || ''}` : 'closed'} open={importOpen} initialUrl={url} initialResolved={resolved} transcriptUnavailable={needsTranscript} onClose={() => setImportOpen(false)} onLesson={openLesson} /></>;
}
