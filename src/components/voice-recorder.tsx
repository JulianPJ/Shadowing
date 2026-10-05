'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Trash2, LoaderCircle, Sparkles, RotateCcw } from 'lucide-react';
import { shadowingScoreLabel, type ShadowingSectionResult } from '@/lib/shadowing-score';

export function VoiceRecorder({
  enabled,
  nativePlaying,
  onBeforeRecord,
  onRecording,
  onAttempt,
  analysis,
  analyzing = false,
  analysisError = '',
  onAnalyze,
  onNewRecording,
}: {
  enabled: boolean;
  nativePlaying: boolean;
  onBeforeRecord: () => void;
  onRecording: (active: boolean) => void;
  onAttempt?: () => void;
  analysis?: ShadowingSectionResult;
  analyzing?: boolean;
  analysisError?: string;
  onAnalyze?: (recording: Blob, durationSeconds: number) => Promise<boolean>;
  onNewRecording?: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [recorded, setRecorded] = useState('');
  const [recordedDuration, setRecordedDuration] = useState(0);
  const [analyzedCurrent, setAnalyzedCurrent] = useState(false);
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recordedBlob = useRef<Blob | null>(null);
  const recordingStartedAt = useRef(0);
  const stream = useRef<MediaStream | null>(null);
  const objectUrl = useRef('');
  const mounted = useRef(false);
  const requestId = useRef(0);
  const callback = useRef(onRecording);

  useEffect(() => {
    callback.current = onRecording;
  }, [onRecording]);
  useEffect(() => {
    if (nativePlaying) audio.current?.pause();
  }, [nativePlaying]);
  useEffect(() => {
    mounted.current = true;
    const request = requestId;
    return () => {
      mounted.current = false;
      request.current++;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      recordedBlob.current = null;
      callback.current(false);
    };
  }, []);
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    const max = setTimeout(() => recorder.current?.stop(), 60000);
    return () => {
      clearInterval(timer);
      clearTimeout(max);
    };
  }, [recording]);

  async function start() {
    setError('');
    onNewRecording?.();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError(
        'Recording needs HTTPS or localhost and a browser with microphone support. You can still shadow aloud.',
      );
      return;
    }
    const id = ++requestId.current;
    setRequesting(true);
    audio.current?.pause();
    onBeforeRecord();
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (!mounted.current || id !== requestId.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/webm',
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const instance = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      recorder.current = instance;
      const chunks: BlobPart[] = [];
      instance.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      instance.onstop = () => {
        media.getTracks().forEach((track) => track.stop());
        if (!mounted.current) return;
        if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
        const blob = new Blob(chunks, { type: instance.mimeType || mimeType || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        objectUrl.current = url;
        recordedBlob.current = blob;
        setRecorded(url);
        setRecordedDuration(Math.max(0, (performance.now() - recordingStartedAt.current) / 1000));
        setAnalyzedCurrent(false);
        setRecording(false);
        callback.current(false);
      };
      instance.onerror = () => {
        setError('Recording was interrupted. Please try again.');
        media.getTracks().forEach((track) => track.stop());
        setRecording(false);
        callback.current(false);
      };
      recordingStartedAt.current = performance.now();
      instance.start();
      onAttempt?.();
      setSeconds(0);
      setRecording(true);
      callback.current(true);
    } catch (error) {
      if (id !== requestId.current) return;
      const name = error instanceof DOMException ? error.name : '';
      setError(
        name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow it in your browser’s site settings, then try again. You can also practice aloud without recording.'
          : name === 'NotFoundError'
            ? 'No microphone was found. Connect one and try again.'
            : 'The microphone could not start. Check that another app isn’t using it and try again.',
      );
    } finally {
      if (mounted.current && id === requestId.current) setRequesting(false);
    }
  }

  async function analyze() {
    if (!recordedBlob.current || !onAnalyze || analyzing || analyzedCurrent) return;
    const ok = await onAnalyze(recordedBlob.current, recordedDuration);
    if (mounted.current && ok) setAnalyzedCurrent(true);
  }

  function clearRecording() {
    if (recorded) URL.revokeObjectURL(recorded);
    objectUrl.current = '';
    recordedBlob.current = null;
    setRecorded('');
    setRecordedDuration(0);
    setAnalyzedCurrent(false);
  }

  return (
    <div className={`recording-panel ${recording ? 'is-recording' : ''}`}>
      <div className="recording-top">
        <div>
          <span className="small-label">MAKE IT YOUR OWN</span>
          <span className="recording-hint">
            {recording
              ? `Recording · 0:${String(seconds).padStart(2, '0')}`
              : recorded
                ? 'Listen back, or analyse this attempt against the section.'
                : 'Say it aloud. Record it if you like.'}
          </span>
        </div>
        <button
          className={`button record-button ${recording ? 'recording' : ''}`}
          disabled={(!enabled && !recording) || requesting || analyzing}
          onClick={() => (recording ? recorder.current?.stop() : void start())}
        >
          {recording ? (
            <>
              <Square size={13} fill="currentColor" />
              Stop recording
            </>
          ) : requesting ? (
            <>
              <LoaderCircle className="spin" size={15} />
              Allow microphone…
            </>
          ) : (
            <>
              <Mic size={15} />
              {recorded ? 'Record again' : 'Record yourself'}
            </>
          )}
        </button>
      </div>

      {requesting ? (
        <button
          className="text-button small"
          onClick={() => {
            requestId.current++;
            setRequesting(false);
          }}
        >
          Cancel microphone request
        </button>
      ) : null}

      {recorded ? (
        <>
          <div className="recording-audio">
            <audio
              ref={audio}
              src={recorded}
              controls
              aria-label="Your recorded attempt"
              onPlay={onBeforeRecord}
            />
            <button className="icon-button" aria-label="Delete your recording" onClick={clearRecording}>
              <Trash2 size={16} />
            </button>
          </div>
          {onAnalyze ? (
            <div className="recording-analysis-actions">
              <button
                className="button shadowing-analyze-button"
                disabled={analyzing || analyzedCurrent}
                onClick={() => void analyze()}
              >
                {analyzing ? (
                  <>
                    <LoaderCircle className="spin" size={15} />
                    Analysing…
                  </>
                ) : analyzedCurrent ? (
                  <>
                    <Sparkles size={15} />
                    Attempt analysed
                  </>
                ) : (
                  <>
                    <Sparkles size={15} />
                    Analyse attempt
                  </>
                )}
              </button>
              <span>
                Analysing sends only this recording to Cloudflare AI for transcription. Hibiki does
                not save the recording server-side.
              </span>
            </div>
          ) : null}
        </>
      ) : null}

      {analysis ? (
        <section className="shadowing-result" aria-labelledby="shadowing-match-title">
          <div className="shadowing-result-heading">
            <div>
              <span className="small-label">LATEST SCORED ATTEMPT</span>
              <h3 id="shadowing-match-title">Shadowing Match</h3>
            </div>
            <strong className="shadowing-score">{analysis.score}</strong>
          </div>
          <p className="shadowing-score-label">{shadowingScoreLabel(analysis.score)}</p>
          <dl className="shadowing-comparison">
            <div>
              <dt>Target</dt>
              <dd lang="ja">{analysis.targetText}</dd>
            </div>
            <div>
              <dt>Heard</dt>
              <dd lang="ja">{analysis.recognizedText}</dd>
            </div>
          </dl>
          <div className="shadowing-suggestions">
            <strong>Suggestions</strong>
            <ul>
              {analysis.suggestions.map((suggestion, index) => (
                <li key={index}>{suggestion}</li>
              ))}
            </ul>
          </div>
          <button className="text-button shadowing-retry" disabled={!enabled || analyzing} onClick={() => void start()}>
            <RotateCcw size={14} />
            Try again
          </button>
        </section>
      ) : null}

      {analysisError ? (
        <p className="small recording-error" role="alert">
          {analysisError}
        </p>
      ) : null}
      {error ? (
        <p className="small recording-error" role="alert">
          {error}
        </p>
      ) : null}
      <span className="recording-privacy">
        Recordings stay in this browser unless you explicitly choose Analyse attempt, and are cleared
        when you change sections.
      </span>
    </div>
  );
}
