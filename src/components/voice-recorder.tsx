'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Trash2, LoaderCircle, Sparkles, RotateCcw } from 'lucide-react';
import type { Segment } from '@/lib/types';
import type { ShadowingScoreAnalysis } from '@/lib/shadowing-score';
import {
  requestShadowingFeedback,
  scoreRecognizedShadowing,
  transcribeShadowingRecording,
} from '@/lib/shadowing-client';

export function VoiceRecorder({
  enabled,
  nativePlaying,
  target,
  initialAnalysis,
  onBeforeRecord,
  onRecording,
  onAttempt,
  onScored,
}: {
  enabled: boolean;
  nativePlaying: boolean;
  target: Segment;
  initialAnalysis?: ShadowingScoreAnalysis;
  onBeforeRecord: () => void;
  onRecording: (active: boolean) => void;
  onAttempt?: () => void;
  onScored: (analysis: ShadowingScoreAnalysis) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [recorded, setRecorded] = useState('');
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [error, setError] = useState('');
  const [analysisError, setAnalysisError] = useState('');
  const [analysing, setAnalysing] = useState(false);
  const [analysis, setAnalysis] = useState<ShadowingScoreAnalysis | undefined>(initialAnalysis);
  const [seconds, setSeconds] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const objectUrl = useRef('');
  const mounted = useRef(false);
  const requestId = useRef(0);
  const analysisRequest = useRef<AbortController | null>(null);
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
      analysisRequest.current?.abort();
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
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
    setAnalysisError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError(
        'Recording needs HTTPS or localhost and a browser with microphone support. You can still shadow aloud.',
      );
      return;
    }
    analysisRequest.current?.abort();
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
        setRecorded(url);
        setRecordedBlob(blob);
        setRecording(false);
        callback.current(false);
      };
      instance.onerror = () => {
        setError('Recording was interrupted. Please try again.');
        media.getTracks().forEach((track) => track.stop());
        setRecording(false);
        callback.current(false);
      };
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

  async function analyse() {
    if (!recordedBlob || analysing) return;
    analysisRequest.current?.abort();
    const controller = new AbortController();
    analysisRequest.current = controller;
    setAnalysisError('');
    setAnalysing(true);
    try {
      const transcription = await transcribeShadowingRecording(
        recordedBlob,
        AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
      );
      const scored = await scoreRecognizedShadowing(
        target,
        transcription.recognizedText,
        transcription.speechDuration,
      );
      if (!scored.valid) {
        setAnalysisError(scored.message);
        return;
      }
      const withFeedback = await requestShadowingFeedback(
        scored.analysis,
        AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
      ).catch(() => scored.analysis);
      if (!controller.signal.aborted && mounted.current) {
        setAnalysis(withFeedback);
        onScored(withFeedback);
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setAnalysisError(
          error instanceof Error
            ? error.message
            : 'This attempt could not be analysed. Your recording is still on this device.',
        );
    } finally {
      if (!controller.signal.aborted && mounted.current) setAnalysing(false);
    }
  }

  function deleteRecording() {
    analysisRequest.current?.abort();
    if (recorded) URL.revokeObjectURL(recorded);
    objectUrl.current = '';
    setRecorded('');
    setRecordedBlob(null);
    setAnalysisError('');
    setAnalysing(false);
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
                ? 'Listen back, or analyse how closely it matched this section.'
                : 'Say it aloud. Record it if you like.'}
          </span>
        </div>
        <button
          className={`button record-button ${recording ? 'recording' : ''}`}
          disabled={(!enabled && !recording) || requesting || analysing}
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
            <button className="icon-button" aria-label="Delete your recording" onClick={deleteRecording}>
              <Trash2 size={16} />
            </button>
          </div>
          <button
            className="button shadowing-analyse-button"
            type="button"
            disabled={analysing}
            onClick={() => void analyse()}
          >
            {analysing ? (
              <>
                <LoaderCircle className="spin" size={15} />
                Analysing attempt…
              </>
            ) : (
              <>
                <Sparkles size={15} />
                Analyse attempt
              </>
            )}
          </button>
        </>
      ) : null}

      {error ? (
        <p className="small recording-error" role="alert">
          {error}
        </p>
      ) : null}
      {analysisError ? (
        <p className="small recording-error" role="alert">
          {analysisError}
        </p>
      ) : null}

      {analysis ? (
        <div className="shadowing-match" data-testid="shadowing-match">
          <div className="shadowing-match-heading">
            <div>
              <span className="small-label">SHADOWING MATCH</span>
              <strong>{analysis.score}</strong>
            </div>
            <span>
              Content {analysis.contentScore} · Timing {analysis.timingScore}
            </span>
          </div>
          <div className="shadowing-match-copy">
            <div>
              <span>Target</span>
              <p lang="ja">{analysis.targetText}</p>
            </div>
            <div>
              <span>Heard</span>
              <p lang="ja">{analysis.recognizedText}</p>
            </div>
          </div>
          <div className="shadowing-suggestions">
            <span>Suggestions</span>
            <ul>
              {analysis.suggestions.map((suggestion, index) => (
                <li key={index}>{suggestion}</li>
              ))}
            </ul>
          </div>
          <button className="text-button" type="button" onClick={() => void start()} disabled={!enabled}>
            <RotateCcw size={13} />
            Try again
          </button>
        </div>
      ) : null}

      <span className="recording-privacy">
        Your recording stays on this device unless you choose Analyse attempt. Analysis sends this
        attempt to Cloudflare AI for transcription; Hibiki does not save the recording server-side.
      </span>
    </div>
  );
}
