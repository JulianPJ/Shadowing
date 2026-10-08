'use client';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Mic, Square, Trash2, LoaderCircle, Sparkles, RotateCcw } from 'lucide-react';
import {
  shadowingAlignmentChunks,
  shadowingPaceBand,
  shadowingScoreLabel,
  type ShadowingSectionResult,
} from '@/lib/shadowing-score';
import { shadowingSectionTrend, type ShadowingRecentAttempt } from '@/lib/shadowing-session';
import { recordingAudioDiagnostics } from '@/lib/audio-diagnostics-client';
import type { AudioDiagnostics } from '@/lib/audio-diagnostics';
import { AudioDiagnosticsPanel } from './audio-diagnostics-panel';
import { ProFeatureNotice, useProAccess } from './pro-feature';

export type VoiceRecorderHandle = {
  prepare: () => Promise<boolean>;
  recordFor: (seconds: number) => Promise<boolean>;
  cancel: () => void;
};
export type VoiceRecorderReference = {
  recording: Blob;
  durationSeconds: number;
  playbackSpeed: number;
};

export function VoiceRecorder({
  ref,
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
  recentAttempts = [],
  onManualStop,
  referenceAudio,
  onReplayNative,
}: {
  ref?: Ref<VoiceRecorderHandle>;
  enabled: boolean;
  nativePlaying: boolean;
  onBeforeRecord: (automatic?: boolean) => void;
  onRecording: (active: boolean) => void;
  onAttempt?: () => void;
  analysis?: ShadowingSectionResult;
  analyzing?: boolean;
  analysisError?: string;
  onAnalyze?: (recording: Blob, durationSeconds: number) => Promise<boolean>;
  onNewRecording?: () => void;
  recentAttempts?: ShadowingRecentAttempt[];
  onManualStop?: () => void;
  referenceAudio?: (signal: AbortSignal) => Promise<VoiceRecorderReference>;
  onReplayNative?: () => void;
}) {
  const { isPro } = useProAccess();
  const [recording, setRecording] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [recorded, setRecorded] = useState('');
  const [recordedDuration, setRecordedDuration] = useState(0);
  const [analyzedCurrent, setAnalyzedCurrent] = useState(false);
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [localDiagnostics, setLocalDiagnostics] = useState<AudioDiagnostics>();
  const [localAnalyzing, setLocalAnalyzing] = useState(false);
  const [localError, setLocalError] = useState('');
  const [referenceDiagnostics, setReferenceDiagnostics] = useState<{
    result: AudioDiagnostics;
    speed: number;
  }>();
  const audio = useRef<HTMLAudioElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const manuallyStopped = useRef<{ recorder: MediaRecorder; request: number } | null>(null);
  const recordedBlob = useRef<Blob | null>(null);
  const recordingStartedAt = useRef(0);
  const stream = useRef<MediaStream | null>(null);
  const objectUrl = useRef('');
  const mounted = useRef(false);
  const requestId = useRef(0);
  const callback = useRef(onRecording);
  const automaticDone = useRef<((ok: boolean) => void) | null>(null);
  const automaticTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localController = useRef<AbortController | null>(null);

  function cancelLocalCheck(reset = true) {
    localController.current?.abort();
    localController.current = null;
    setLocalAnalyzing(false);
    if (reset) {
      setLocalDiagnostics(undefined);
      setReferenceDiagnostics(undefined);
    }
    setLocalError('');
  }

  function cancel() {
    manuallyStopped.current = null;
    requestId.current++;
    cancelLocalCheck(false);
    if (automaticTimer.current) clearTimeout(automaticTimer.current);
    automaticTimer.current = null;
    automaticDone.current?.(false);
    automaticDone.current = null;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
    setRecording(false);
    callback.current(false);
    setRequesting(false);
  }

  useImperativeHandle(ref, () => ({
    async prepare() {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        setError(
          'Recording needs HTTPS or localhost and a browser with microphone support. You can still shadow aloud.',
        );
        return false;
      }
      const id = ++requestId.current;
      setRequesting(true);
      try {
        const permission = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        permission.getTracks().forEach((track) => track.stop());
        return mounted.current && id === requestId.current;
      } catch {
        if (mounted.current && id === requestId.current)
          setError(
            'Microphone access was denied or unavailable. Allow it in your browser settings, or continue with manual practice.',
          );
        return false;
      } finally {
        if (mounted.current && id === requestId.current) setRequesting(false);
      }
    },
    async recordFor(duration) {
      const started = await start(true);
      if (!started) return false;
      return new Promise<boolean>((resolve) => {
        automaticDone.current = resolve;
        automaticTimer.current = setTimeout(() => {
          if (recorder.current?.state === 'recording') recorder.current.stop();
        }, duration * 1000);
      });
    },
    cancel,
  }));

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
      localController.current?.abort();
      if (automaticTimer.current) clearTimeout(automaticTimer.current);
      automaticDone.current?.(false);
      automaticDone.current = null;
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

  async function start(automatic = false) {
    setError('');
    manuallyStopped.current = null;
    cancelLocalCheck();
    onNewRecording?.();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError(
        'Recording needs HTTPS or localhost and a browser with microphone support. You can still shadow aloud.',
      );
      return false;
    }
    const id = ++requestId.current;
    setRequesting(true);
    audio.current?.pause();
    onBeforeRecord(automatic);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (!mounted.current || id !== requestId.current) {
        media.getTracks().forEach((track) => track.stop());
        return false;
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
        const manualStop = manuallyStopped.current;
        if (
          !mounted.current ||
          (id !== requestId.current &&
            !(manualStop?.recorder === instance && manualStop.request === requestId.current))
        )
          return;
        manuallyStopped.current = null;
        cancelLocalCheck();
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
        if (automaticTimer.current) clearTimeout(automaticTimer.current);
        automaticTimer.current = null;
        automaticDone.current?.(true);
        automaticDone.current = null;
      };
      instance.onerror = () => {
        media.getTracks().forEach((track) => track.stop());
        if (!mounted.current || id !== requestId.current) return;
        requestId.current++;
        manuallyStopped.current = null;
        setError('Recording was interrupted. Please try again.');
        setRecording(false);
        callback.current(false);
        if (automaticTimer.current) clearTimeout(automaticTimer.current);
        automaticTimer.current = null;
        automaticDone.current?.(false);
        automaticDone.current = null;
      };
      recordingStartedAt.current = performance.now();
      instance.start();
      onAttempt?.();
      setSeconds(0);
      setRecording(true);
      callback.current(true);
      return true;
    } catch (error) {
      stream.current?.getTracks().forEach((track) => track.stop());
      if (id !== requestId.current) return false;
      const name = error instanceof DOMException ? error.name : '';
      setError(
        name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow it in your browser’s site settings, then try again. You can also practice aloud without recording.'
          : name === 'NotFoundError'
            ? 'No microphone was found. Connect one and try again.'
            : 'The microphone could not start. Check that another app isn’t using it and try again.',
      );
      return false;
    } finally {
      if (mounted.current && id === requestId.current) setRequesting(false);
    }
  }

  async function analyze() {
    if (
      !isPro ||
      !recordedBlob.current ||
      !onAnalyze ||
      analyzing ||
      analyzedCurrent ||
      recording ||
      requesting
    )
      return;
    const blob = recordedBlob.current;
    if (!localDiagnostics && !localController.current) void checkRecordingLocally();
    const ok = await onAnalyze(blob, recordedDuration);
    if (mounted.current && recordedBlob.current === blob && ok) setAnalyzedCurrent(true);
  }

  async function checkRecordingLocally() {
    const blob = recordedBlob.current;
    if (!blob || localController.current || recording || requesting) return;
    const controller = new AbortController();
    localController.current = controller;
    setLocalAnalyzing(true);
    setLocalError('');
    try {
      const result = await recordingAudioDiagnostics(blob, recordedDuration, controller.signal);
      if (!mounted.current || controller.signal.aborted || recordedBlob.current !== blob) return;
      setLocalDiagnostics(result);
      if (referenceAudio && result.activity === 'detected') {
        try {
          const reference = await referenceAudio(controller.signal);
          const sourceResult = await recordingAudioDiagnostics(
            reference.recording,
            reference.durationSeconds,
            controller.signal,
            reference.playbackSpeed,
          );
          if (mounted.current && !controller.signal.aborted && recordedBlob.current === blob) {
            if (sourceResult.activity === 'detected')
              setReferenceDiagnostics({ result: sourceResult, speed: reference.playbackSpeed });
            else setLocalError('Source activity was unclear, so only your recording is shown.');
          }
        } catch {
          if (mounted.current && !controller.signal.aborted && recordedBlob.current === blob)
            setLocalError(
              'Source audio could not be checked locally. Your recording check is still available.',
            );
        }
      }
    } catch (error) {
      if (mounted.current && !controller.signal.aborted && recordedBlob.current === blob)
        setLocalError(
          error instanceof Error ? error.message : 'Local recording check unavailable.',
        );
    } finally {
      if (localController.current === controller) {
        localController.current = null;
        if (mounted.current) setLocalAnalyzing(false);
      }
    }
  }

  function clearRecording() {
    manuallyStopped.current = null;
    cancelLocalCheck();
    onNewRecording?.();
    if (recorded) URL.revokeObjectURL(recorded);
    objectUrl.current = '';
    recordedBlob.current = null;
    setRecorded('');
    setRecordedDuration(0);
    setAnalyzedCurrent(false);
  }

  return (
    <div className={`recording-panel ${recording ? 'is-recording' : ''}`}>
      <div className="recording-core">
        <div className="recording-top">
          <div>
            <span className="small-label">MAKE IT YOUR OWN</span>
            <span className="recording-hint">
              {recording
                ? `Recording · 0:${String(seconds).padStart(2, '0')}`
                : recorded
                  ? 'Listen to your voice, then replay the source to compare.'
                  : 'Say it aloud. Record it if you like.'}
            </span>
          </div>
          <button
            className={`button record-button ${recording ? 'recording' : ''}`}
            disabled={(!enabled && !recording) || requesting || analyzing}
            onClick={() => {
              if (recording) {
                const instance = recorder.current;
                if (instance?.state === 'recording') instance.stop();
                onManualStop?.();
                if (instance)
                  manuallyStopped.current = { recorder: instance, request: requestId.current };
              } else void start();
            }}
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
        <p className="recording-retention">
          {recorded
            ? 'This recording will be cleared when you leave this section.'
            : 'Recording is optional. Audio stays here until you change sections.'}
        </p>

        {requesting ? (
          <button
            className="text-button small"
            onClick={() => {
              onManualStop?.();
              cancel();
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
                onPlay={() => onBeforeRecord()}
              />
              <button
                className="icon-button"
                aria-label="Delete your recording"
                onClick={clearRecording}
              >
                <Trash2 size={16} />
              </button>
            </div>
            {onReplayNative ? (
              <button
                className="button recording-compare"
                disabled={recording || requesting}
                onClick={onReplayNative}
              >
                <RotateCcw size={15} />
                Replay source to compare
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      {recorded ? (
        <>
          <div className="recording-analysis-actions">
            <button
              className="text-button small"
              disabled={(Boolean(localDiagnostics) && !localAnalyzing) || recording || requesting}
              onClick={() => {
                if (localAnalyzing) cancelLocalCheck();
                else void checkRecordingLocally();
              }}
            >
              {localAnalyzing
                ? 'Cancel local check'
                : localDiagnostics
                  ? 'Recording checked locally'
                  : 'Check recording locally'}
            </button>
            <span>Check sound activity, pauses and recording level on this device.</span>
          </div>
          {onAnalyze ? (
            isPro ? (
              <div className="recording-analysis-actions">
                <button
                  className="button shadowing-analyze-button"
                  disabled={analyzing || analyzedCurrent || recording || requesting}
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
                  Analysing sends only this recording to Cloudflare AI for transcription. Hibiki
                  does not save the recording server-side.
                </span>
              </div>
            ) : (
              <ProFeatureNotice feature="Shadowing Match recording analysis" compact />
            )
          ) : null}
        </>
      ) : null}

      {localDiagnostics ? (
        <AudioDiagnosticsPanel
          result={localDiagnostics}
          reference={referenceDiagnostics?.result}
          referenceSpeed={referenceDiagnostics?.speed}
        />
      ) : null}
      {localError ? (
        <p className="small recording-error" role="status">
          {localError}
        </p>
      ) : null}

      {analysis && isPro ? (
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
          <div className="shadowing-diagnostics">
            <strong>What the recognizer heard</strong>
            <p className="small muted">
              {analysis.normalization === 'reading'
                ? 'Aligned dictionary readings'
                : 'Aligned written text'}
              ; this describes recognition, not individual sounds, pitch accent or pronunciation.
            </p>
            <ol className="alignment-chunks" aria-label="Recognized alignment chunks">
              {shadowingAlignmentChunks(analysis.alignment).map((chunk, index) => (
                <li key={index} className={`alignment-${chunk.type}`}>
                  <span>
                    {
                      {
                        match: 'Matched',
                        deletion: 'Not heard',
                        substitution: 'Heard differently',
                        insertion: 'Extra heard',
                      }[chunk.type]
                    }
                  </span>
                  <span lang="ja">
                    {chunk.type === 'substitution'
                      ? `${chunk.expected} → ${chunk.heard}`
                      : (chunk.expected ?? chunk.heard)}
                  </span>
                </li>
              ))}
            </ol>
            <p className="shadowing-pace" data-testid="shadowing-pace">
              Speaking window: {analysis.recordingDurationSeconds.toFixed(1)} s heard /{' '}
              {analysis.referenceDurationSeconds.toFixed(1)} s source at selected speed.{' '}
              {shadowingPaceBand(analysis.relativeSpeakingSpeed) === 'close'
                ? 'Overall pace close to source.'
                : `${Math.round(Math.abs(analysis.recordingDurationSeconds / analysis.referenceDurationSeconds - 1) * 100)}% ${analysis.recordingDurationSeconds < analysis.referenceDurationSeconds ? 'shorter' : 'longer'} than source.`}
            </p>
          </div>
          <div className="shadowing-suggestions">
            <strong>Suggestions</strong>
            <ul>
              {analysis.suggestions.map((suggestion, index) => (
                <li key={index}>{suggestion}</li>
              ))}
            </ul>
          </div>
          <button
            className="text-button shadowing-retry"
            disabled={!enabled || analyzing}
            onClick={() => void start()}
          >
            <RotateCcw size={14} />
            Try again
          </button>
        </section>
      ) : null}

      {recentAttempts.length ? (
        <section className="shadowing-trend" aria-label="Recent section trend">
          <strong>Recent section match</strong>
          <p>{recentAttempts.map((attempt) => attempt.score).join(' → ')}</p>
          <span className="small muted">
            {shadowingSectionTrend(recentAttempts)?.label ??
              'Another attempt at the same playback speed will show a comparison.'}{' '}
            · Last {recentAttempts.length} valid{' '}
            {recentAttempts.length === 1 ? 'attempt' : 'attempts'} on this device. Scores compare
            recognition and overall timing.
          </span>
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
        Recordings stay in this browser unless you explicitly choose Analyse attempt, and are
        cleared when you change sections.
      </span>
    </div>
  );
}
