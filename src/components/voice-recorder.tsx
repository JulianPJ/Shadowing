'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Trash2, LoaderCircle } from 'lucide-react';

export function VoiceRecorder({
  enabled,
  nativePlaying,
  onBeforeRecord,
  onRecording,
  onAttempt,
}: {
  enabled: boolean;
  nativePlaying: boolean;
  onBeforeRecord: () => void;
  onRecording: (active: boolean) => void;
  onAttempt?: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [recorded, setRecorded] = useState('');
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
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
        const url = URL.createObjectURL(new Blob(chunks, { type: instance.mimeType }));
        objectUrl.current = url;
        setRecorded(url);
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
  return (
    <div className={`recording-panel ${recording ? 'is-recording' : ''}`}>
      <div className="recording-top">
        <div>
          <span className="small-label">MAKE IT YOUR OWN</span>
          <span className="recording-hint">
            {recording
              ? `Recording · 0:${String(seconds).padStart(2, '0')}`
              : recorded
                ? 'Listen to your voice, then compare with the original.'
                : 'Say it aloud. Record it if you like.'}
          </span>
        </div>
        <button
          className={`button record-button ${recording ? 'recording' : ''}`}
          disabled={(!enabled && !recording) || requesting}
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
        <div className="recording-audio">
          <audio
            ref={audio}
            src={recorded}
            controls
            aria-label="Your recorded attempt"
            onPlay={onBeforeRecord}
          />
          <button
            className="icon-button"
            aria-label="Delete your recording"
            onClick={() => {
              URL.revokeObjectURL(recorded);
              objectUrl.current = '';
              setRecorded('');
            }}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="small recording-error" role="alert">
          {error}
        </p>
      ) : null}
      <span className="recording-privacy">
        Only on this device. Cleared when you change sections.
      </span>
    </div>
  );
}
