'use client';
import { useEffect, useRef, useState } from 'react';
import { X, Upload, ArrowRight, FileText, LoaderCircle, SquarePlay as Youtube } from 'lucide-react';
import { parseSubtitles } from '@/lib/subtitles';
import { segmentTranscript } from '@/lib/segmentation';
import { parseYouTubeUrl } from '@/lib/youtube';
import { localWhisper } from '@/lib/providers/local-whisper';
import type { Lesson } from '@/lib/types';

export function ImportDialog({ open, onClose, onLesson, initialUrl = '' }: { open: boolean; onClose: () => void; onLesson: (lesson: Lesson) => void; initialUrl?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [kind, setKind] = useState<'youtube' | 'upload'>('youtube');
  const [url, setUrl] = useState(initialUrl);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [subtitleName, setSubtitleName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) dialog.current?.showModal(); else { dialog.current?.close(); abort.current?.abort(); } }, [open]);
  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setError('Use a subtitle file smaller than 2 MB.'); return; }
    setError(''); setText(await file.text()); setSubtitleName(file.name);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    const controller = new AbortController(); abort.current = controller;
    try {
      const videoId = kind === 'youtube' ? parseYouTubeUrl(url) : undefined;
      if (kind === 'upload' && !file) throw new Error('Choose an audio or video file first.');
      if (file && file.size > 250 * 1024 * 1024) throw new Error('Please use media smaller than 250 MB.');
      let cues;
      let source = 'Imported subtitles';
      if (text.trim()) cues = parseSubtitles(text);
      else if (kind === 'upload' && file && process.env.NEXT_PUBLIC_WHISPER_URL) {
        source = 'Local Whisper';
        const result = await localWhisper.transcribe(file, AbortSignal.any([controller.signal, AbortSignal.timeout(300000)]));
        cues = result.cues;
      } else throw new Error('Add a Japanese SRT, VTT, or JSON transcript with timestamps.');
      const segments = segmentTranscript(cues);
      if (!segments.length) throw new Error('No usable spoken sections were found. Check the transcript timings.');
      const lesson: Lesson = { id: videoId ? `youtube-${videoId}` : `upload-${crypto.randomUUID()}`, title: file?.name.replace(/\.[^.]+$/, '') || 'Your Japanese practice', author: kind === 'youtube' ? 'YouTube · your transcript' : 'Your own media', source: kind, videoId, mediaUrl: kind === 'upload' && file ? URL.createObjectURL(file) : undefined, mediaName: file?.name, segments, transcriptSource: source };
      if (!controller.signal.aborted) { onLesson(lesson); onClose(); }
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Import failed. Try another transcript.'); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="import-dialog" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }} aria-labelledby="import-title">
    <button className="icon-button dialog-close" aria-label="Close import" onClick={onClose}><X size={20} /></button><span className="eyebrow">BRING YOUR OWN JAPANESE</span><h2 id="import-title">Your next listening session.</h2>
    <p className="muted">Pair a video with Japanese subtitles. Your files stay in this browser.</p>
    <div className="segmented-control import-tabs"><button aria-pressed={kind === 'youtube'} className={kind === 'youtube' ? 'selected' : ''} onClick={() => setKind('youtube')}><Youtube size={16} /> YouTube + subtitles</button><button aria-pressed={kind === 'upload'} className={kind === 'upload' ? 'selected' : ''} onClick={() => setKind('upload')}><Upload size={16} /> Own media</button></div>
    <form onSubmit={submit}>
      {kind === 'youtube' ? <label className="field-label">YouTube video URL<input className="text-input" type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" required /></label> : <label className="upload-field"><Upload size={22} /><strong>{file ? file.name : 'Choose audio or video'}</strong><span>MP4, WebM, MP3, WAV, M4A · up to 250 MB</span><input aria-label="Audio or video file" type="file" accept="video/*,audio/*,.m4a,.mp4,.webm,.mp3,.wav" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>}
      <label className="field-label">Japanese transcript<span className="small muted">SRT, VTT, or JSON with timings in seconds</span></label>
      <label className="subtitle-upload"><FileText size={17} />{subtitleName || 'Choose subtitle file'}<input aria-label="Japanese subtitle file" type="file" accept=".srt,.vtt,.json" onChange={event => void readFile(event.target.files?.[0])} /></label>
      <textarea className="text-input subtitle-text" aria-label="Paste timestamped transcript" value={text} onChange={event => setText(event.target.value)} placeholder={'Or paste a transcript here…\n\n00:00:00.000 --> 00:00:04.500\n今日はいい天気ですね。'} rows={5} maxLength={2000000} />
      {kind === 'upload' && process.env.NEXT_PUBLIC_WHISPER_URL ? <p className="small muted">Without subtitles, this file will be sent to your configured local Whisper service. First use may take a few minutes.</p> : null}
      {error ? <div role="alert" className="error-message">{error}</div> : null}
      <button className="button primary full-width" disabled={busy} type="submit">{busy ? <><LoaderCircle className="spin" size={17} />Preparing your practice…</> : <>Start practicing<ArrowRight size={17} /></>}</button>
    </form>
  </dialog>;
}
