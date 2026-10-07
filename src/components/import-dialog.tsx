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
  Sparkles,
} from 'lucide-react';
import { parseSubtitles } from '@/lib/subtitles';
import { resolveMediaLink } from '@/lib/media-discovery';
import { MEDIA_ACCEPT, validateMediaFile } from '@/lib/media';
import { createImportedLesson } from '@/lib/import-lesson';
import { localMediaUrl } from '@/lib/local-media-file';
import { localWhisper } from '@/lib/providers/local-whisper';
import { transcribeMediaFile, type TranscriptionProgress } from '@/lib/transcription-client';
import type { Lesson, ResolvedMedia } from '@/lib/types';
import { ProFeatureNotice, useProAccess } from './pro-feature';

type SubtitleChoice = 'manual' | 'generate' | null;

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
  const { isPro, account } = useProAccess();
  const dialog = useRef<HTMLDialogElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [kind, setKind] = useState<'link' | 'upload'>('link');
  const [url, setUrl] = useState(initialUrl);
  const [resolved, setResolved] = useState(initialResolved);
  const [file, setFile] = useState<File | null>(null);
  const [generationFile, setGenerationFile] = useState<File | null>(null);
  const [subtitleChoice, setSubtitleChoice] = useState<SubtitleChoice>(null);
  const [text, setText] = useState('');
  const [subtitleName, setSubtitleName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<TranscriptionProgress | null>(null);

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else {
      dialog.current?.close();
      abort.current?.abort();
    }
    return () => abort.current?.abort();
  }, [open]);

  useEffect(() => {
    const cancelForAccountChange = () => abort.current?.abort();
    window.addEventListener('hibiki:account-changing', cancelForAccountChange);
    return () => window.removeEventListener('hibiki:account-changing', cancelForAccountChange);
  }, []);

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
    if (process.env.NEXT_PUBLIC_WHISPER_URL) {
      const timedSignal = AbortSignal.any([signal, AbortSignal.timeout(300000)]);
      const result = await localWhisper.transcribe(file, timedSignal);
      return { ...result, provider: 'Local Whisper' };
    }
    return transcribeMediaFile(
      file,
      signal,
      (value) => {
        if (!signal.aborted) setProgress(value);
      },
      { checkpointScope: account.user?.id },
    );
  }

  function chooseSubtitleMethod(choice: Exclude<SubtitleChoice, null>) {
    if (choice === 'generate' && !isPro) {
      setSubtitleChoice(null);
      setError('');
      return;
    }
    setSubtitleChoice(choice);
    setError('');
  }

  function chooseKind(next: 'link' | 'upload') {
    setKind(next);
    setSubtitleChoice(null);
    setGenerationFile(null);
    setError('');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!subtitleChoice) {
      setError('Choose whether to upload your own subtitles or auto-generate subtitles.');
      return;
    }
    if (subtitleChoice === 'generate' && !isPro) {
      setError('Hibiki Pro is required to auto-generate subtitles.');
      return;
    }

    setError('');
    setBusy(true);
    setProgress(null);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const selected =
        kind === 'link' ? resolved || (await resolveMediaLink(url, controller.signal)) : undefined;
      if (selected) setResolved(selected);
      if (kind === 'upload' && !file) throw new Error('Choose an audio or video file first.');
      if (kind === 'upload' && file) validateMediaFile(file);

      let cues;
      let source = 'Imported subtitles';
      let transcriptType: 'user-upload' | 'user-paste' | 'generated';

      if (subtitleChoice === 'manual') {
        if (!text.trim())
          throw new Error(
            'Upload Japanese subtitles or paste a timestamped transcript before continuing.',
          );
        cues = parseSubtitles(text);
        transcriptType = subtitleName ? 'user-upload' : 'user-paste';
        source = subtitleName ? 'Imported subtitles' : 'Pasted transcript';
      } else {
        const mediaForTranscription = kind === 'upload' ? file : generationFile;
        if (!mediaForTranscription)
          throw new Error(
            kind === 'link'
              ? 'Choose the matching audio or video file to auto-generate subtitles for this link.'
              : 'Choose an audio or video file first.',
          );
        validateMediaFile(mediaForTranscription);
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
        lesson.mediaUrl = localMediaUrl(file);
      if (!controller.signal.aborted) {
        onLesson(lesson);
        onClose();
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : 'Import failed. Try another transcript.');
    } finally {
      if (abort.current === controller) {
        abort.current = null;
        setBusy(false);
        setProgress(null);
      }
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
        Pair a video with Japanese subtitles. Imported transcripts stay in this browser.
      </p>
      {transcriptUnavailable ? (
        <p className="small" role="status">
          No Japanese subtitles were found automatically. Choose how you want to continue below.
        </p>
      ) : null}

      <div className="segmented-control import-tabs">
        <button
          type="button"
          aria-pressed={kind === 'link'}
          className={kind === 'link' ? 'selected' : ''}
          disabled={busy}
          onClick={() => chooseKind('link')}
        >
          <SquarePlay size={16} /> Video link
        </button>
        <button
          type="button"
          aria-pressed={kind === 'upload'}
          className={kind === 'upload' ? 'selected' : ''}
          disabled={busy}
          onClick={() => chooseKind('upload')}
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
              disabled={busy}
            />
          </label>
        ) : (
          <label className="upload-field">
            <Upload size={22} />
            <strong>{file ? file.name : 'Choose audio or video'}</strong>
            <span>Common browser-supported audio/video formats · up to 1 GB</span>
            <input
              aria-label="Audio or video file"
              type="file"
              accept={MEDIA_ACCEPT}
              disabled={busy}
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

        <div className="field-label">
          Subtitles
          <span className="small muted">
            Choose one option. Hibiki will never auto-generate without your selection.
          </span>
        </div>
        <div className="segmented-control import-tabs subtitle-methods">
          <button
            type="button"
            aria-pressed={subtitleChoice === 'manual'}
            className={subtitleChoice === 'manual' ? 'selected' : ''}
            disabled={busy}
            onClick={() => chooseSubtitleMethod('manual')}
          >
            <FileText size={16} /> Upload own subtitles
          </button>
          <button
            type="button"
            aria-pressed={subtitleChoice === 'generate'}
            className={subtitleChoice === 'generate' ? 'selected' : ''}
            disabled={busy || !isPro}
            title={!isPro ? 'Hibiki Pro required' : undefined}
            onClick={() => chooseSubtitleMethod('generate')}
          >
            <Sparkles size={16} /> Auto-generate subtitles
          </button>
        </div>
        {!isPro ? <ProFeatureNotice feature="Auto-generated subtitles" compact /> : null}

        {subtitleChoice === 'manual' ? (
          <>
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
                disabled={busy}
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
              disabled={busy}
            />
          </>
        ) : null}

        {subtitleChoice === 'generate' ? (
          kind === 'link' ? (
            <label className="field-label">
              Audio/video to transcribe
              <span className="small muted">
                Attach the matching media file. Hibiki does not download the linked video for
                transcription. Only its audio is sent for AI subtitles, in small parts. Up to four
                hours of audio is supported.
              </span>
              <span className="subtitle-upload">
                <Upload size={17} />
                {generationFile ? generationFile.name : 'Choose matching audio or video'}
                <input
                  aria-label="Audio or video for subtitle generation"
                  type="file"
                  accept={MEDIA_ACCEPT}
                  disabled={busy}
                  onChange={(event) => setGenerationFile(event.target.files?.[0] ?? null)}
                />
              </span>
            </label>
          ) : (
            <p className="small muted">
              Hibiki will generate timed Japanese subtitles from the media you selected using{' '}
              {process.env.NEXT_PUBLIC_WHISPER_URL
                ? 'your local Whisper service'
                : 'Cloudflare Whisper'}
              .{' '}
              {process.env.NEXT_PUBLIC_WHISPER_URL
                ? 'The local service accepts media up to 250 MB.'
                : 'Your video stays on this device; only audio is sent in small parts, up to four hours.'}
            </p>
          )
        ) : null}

        {error ? (
          <div role="alert" className="error-message">
            {error}
          </div>
        ) : null}

        {busy && progress ? (
          <p className="small muted" role="status" aria-live="polite">
            {progress.message}
            {progress.total > 1 ? ` (${progress.completed} of ${progress.total})` : ''}
          </p>
        ) : null}

        {busy ? (
          <button
            type="button"
            className="button secondary full-width"
            onClick={() => abort.current?.abort()}
          >
            Cancel preparation
          </button>
        ) : null}

        <button
          className="button primary full-width"
          disabled={busy || !subtitleChoice}
          type="submit"
        >
          {busy ? (
            <>
              <LoaderCircle className="spin" size={17} />
              {subtitleChoice === 'generate' ? 'Generating subtitles…' : 'Preparing your practice…'}
            </>
          ) : (
            <>
              {subtitleChoice === 'generate' ? 'Generate subtitles & start' : 'Start practicing'}
              <ArrowRight size={17} />
            </>
          )}
        </button>
      </form>
    </dialog>
  );
}
