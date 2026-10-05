'use client';
import { useEffect, useRef, useState } from 'react';
import {
  X,
  Upload,
  ArrowRight,
  FileText,
  LoaderCircle,
  SquarePlay,
  ExternalLink,
} from 'lucide-react';
import { parseSubtitles } from '@/lib/subtitles';
import { resolveMediaLink } from '@/lib/media-discovery';
import { MEDIA_ACCEPT, validateMediaFile } from '@/lib/media';
import { createImportedLesson } from '@/lib/import-lesson';
import { localWhisper } from '@/lib/providers/local-whisper';
import { transcribeMediaFile } from '@/lib/transcription-client';
import type { Lesson, ResolvedMedia } from '@/lib/types';

export function ImportDialog({
  open,
  onClose,
  onLesson,
  initialUrl = '',
  initialResolved,
  transcriptUnavailable = false,
}: {
  open: boolean;
  onClose: () => void;
  onLesson: (lesson: Lesson) => void;
  initialUrl?: string;
  initialResolved?: ResolvedMedia;
  transcriptUnavailable?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [kind, setKind] = useState<'link' | 'upload'>('link');
  const [url, setUrl] = useState(initialUrl);
  const [resolved, setResolved] = useState(initialResolved);
  const [file, setFile] = useState<File | null>(null);
  const [generationFile, setGenerationFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [subtitleName, setSubtitleName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else {
      dialog.current?.close();
      abort.current?.abort();
    }
    return () => abort.current?.abort();
  }, [open]);
  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('Use a subtitle file smaller than 2 MB.');
      return;
    }
    try {
      const content = await file.text();
      setError('');
      setText(content);
      setSubtitleName(file.name);
    } catch {
      setError('This transcript file could not be read. Choose it again.');
    }
  }
  async function generateSubtitles(file: File, signal: AbortSignal) {
    const timedSignal = AbortSignal.any([signal, AbortSignal.timeout(300000)]);
    if (process.env.NEXT_PUBLIC_WHISPER_URL) {
      const result = await localWhisper.transcribe(file, timedSignal);
      return { ...result, provider: 'Local Whisper' };
    }
    return transcribeMediaFile(file, timedSignal);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const selected =
        kind === 'link' ? resolved || (await resolveMediaLink(url, controller.signal)) : undefined;
      if (selected) setResolved(selected);
      if (kind === 'upload' && !file) throw new Error('Choose an audio or video file first.');
      if (kind === 'upload' && file) validateMediaFile(file);
      if (kind === 'link' && generationFile) validateMediaFile(generationFile);
      let cues;
      let source = 'Imported subtitles';
      let transcriptType: 'user-upload' | 'user-paste' | 'generated' = subtitleName
        ? 'user-upload'
        : 'user-paste';
      if (text.trim()) cues = parseSubtitles(text);
      else {
        const mediaForTranscription = kind === 'upload' ? file : generationFile;
        if (!mediaForTranscription)
          throw new Error(
            'Add Japanese subtitles, or choose an audio/video file so Hibiki can generate them.',
          );
        const result = await generateSubtitles(mediaForTranscription, controller.signal);
        source = result.provider || 'Cloudflare Whisper large-v3-turbo';
        transcriptType = 'generated';
        cues = result.cues;
      }
      const lesson = await createImportedLesson({
        resolved: selected,
        fileName: kind === 'upload' ? file?.name : undefined,
        cues,
        transcriptType,
        provenance: source,
      });
      if (kind === 'upload' && file && !controller.signal.aborted)
        lesson.mediaUrl = URL.createObjectURL(file);
      if (!controller.signal.aborted) {
        onLesson(lesson);
        onClose();
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : 'Import failed. Try another transcript.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="import-dialog"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      aria-labelledby="import-title"
    >
      <button className="icon-button dialog-close" aria-label="Close import" onClick={onClose}>
        <X size={20} />
      </button>
      <span className="eyebrow">BRING YOUR OWN JAPANESE</span>
      <h2 id="import-title">Your next listening session.</h2>
      <p className="muted">
        Pair a video with a Japanese transcript. Imported transcripts stay in this browser.
      </p>
      {transcriptUnavailable ? (
        <p className="small" role="status">
          No Japanese subtitles were found automatically. Add your own transcript, or attach the video/audio below and Hibiki can generate Japanese subtitles.
        </p>
      ) : null}
      <div className="segmented-control import-tabs">
        <button
          aria-pressed={kind === 'link'}
          className={kind === 'link' ? 'selected' : ''}
          onClick={() => setKind('link')}
        >
          <SquarePlay size={16} /> Video link + transcript
        </button>
        <button
          aria-pressed={kind === 'upload'}
          className={kind === 'upload' ? 'selected' : ''}
          onClick={() => setKind('upload')}
        >
          <Upload size={16} /> Own media
        </button>
      </div>
      <form onSubmit={submit}>
        {kind === 'link' ? (
          <label className="field-label">
            Video link
            <input
              className="text-input"
              type="url"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setResolved(undefined);
              }}
              placeholder="https://…"
              maxLength={2000}
              required
            />
          </label>
        ) : (
          <label className="upload-field">
            <Upload size={22} />
            <strong>{file ? file.name : 'Choose audio or video'}</strong>
            <span>Common browser-supported audio/video formats · up to 250 MB</span>
            <input
              aria-label="Audio or video file"
              type="file"
              accept={MEDIA_ACCEPT}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
        )}
        {kind === 'link' && resolved ? (
          <p className="small muted">
            {resolved.title ||
              (resolved.media.type === 'youtube'
                ? 'YouTube'
                : resolved.media.type === 'vimeo'
                  ? 'Vimeo'
                  : 'Direct video')}
            {resolved.media.type === 'direct' && resolved.media.discoveredFrom ? (
              <>
                {' '}
                ·{' '}
                <a href={resolved.media.canonicalUrl} target="_blank" rel="noreferrer">
                  Open extracted media <ExternalLink size={12} />
                </a>
              </>
            ) : null}
          </p>
        ) : null}
        <label className="field-label">
          Japanese transcript
          <span className="small muted">SRT, VTT, ASS, SSA, JSON, or timestamped TXT</span>
        </label>
        <label className="subtitle-upload">
          <FileText size={17} />
          {subtitleName || 'Choose subtitle file'}
          <input
            aria-label="Japanese subtitle file"
            type="file"
            accept=".srt,.vtt,.ass,.ssa,.json,.txt"
            onChange={(event) => void readFile(event.target.files?.[0])}
          />
        </label>
        <textarea
          className="text-input subtitle-text"
          aria-label="Paste timestamped transcript"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setSubtitleName('');
          }}
          placeholder={
            'Or paste a transcript here…\n\n00:00:00.000 --> 00:00:04.500\n今日はいい天気ですね。'
          }
          rows={5}
          maxLength={2000000}
        />
        {kind === 'link' ? (
          <label className="field-label">
            Generate subtitles from audio
            <span className="small muted">
              Optional · attach the matching audio/video file if this link has no usable subtitles.
              AI generation currently accepts files up to 32 MB.
            </span>
            <span className="subtitle-upload">
              <Upload size={17} />
              {generationFile ? generationFile.name : 'Choose audio or video for AI subtitles'}
              <input
                aria-label="Audio or video for subtitle generation"
                type="file"
                accept={MEDIA_ACCEPT}
                onChange={(event) => setGenerationFile(event.target.files?.[0] ?? null)}
              />
            </span>
          </label>
        ) : (
          <p className="small muted">
            Leave the transcript blank and Hibiki will generate timed Japanese subtitles from this
            media with {process.env.NEXT_PUBLIC_WHISPER_URL ? 'your local Whisper service' : 'Cloudflare Whisper'}.
            AI generation currently accepts files up to 32 MB.
          </p>
        )}
        {error ? (
          <div role="alert" className="error-message">
            {error}
          </div>
        ) : null}
        <button className="button primary full-width" disabled={busy} type="submit">
          {busy ? (
            <>
              <LoaderCircle className="spin" size={17} />
              Preparing your practice…
            </>
          ) : (
            <>
              Start practicing
              <ArrowRight size={17} />
            </>
          )}
        </button>
      </form>
    </dialog>
  );
}
