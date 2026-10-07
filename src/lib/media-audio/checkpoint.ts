import { validateCues } from '../segmentation';
import type { Cue } from '../types';

const TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_JOBS = 3;
const MAX_SAVED_BYTES = 2 * 1024 * 1024;
const KEY = 'hibiki:v1:transcription-checkpoints:';
type CompletedChunk = { digest: string; start: number; end: number; cues: Cue[]; provider: string };
type Job = { updatedAt: number; chunks: Record<string, CompletedChunk> };
type Checkpoints = Record<string, Job>;

export async function audioDigest(bytes: ArrayBuffer) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

/** Only bounded source samples are read. Each reused chunk verifies its complete prepared audio digest. */
export async function mediaFingerprint(file: File) {
  const sampleBytes = 64 * 1024;
  const prefix = await file.slice(0, sampleBytes).arrayBuffer();
  const suffix = await file.slice(Math.max(sampleBytes, file.size - sampleBytes)).arrayBuffer();
  const metadata = new TextEncoder().encode(
    JSON.stringify([file.name, file.size, file.lastModified, file.type]),
  );
  const combined = new Uint8Array(prefix.byteLength + suffix.byteLength + metadata.byteLength);
  combined.set(new Uint8Array(prefix), 0);
  combined.set(new Uint8Array(suffix), prefix.byteLength);
  combined.set(metadata, prefix.byteLength + suffix.byteLength);
  return audioDigest(combined.buffer);
}

export class TranscriptionCheckpoints {
  private jobs: Checkpoints = {};
  constructor(
    private storage: Pick<Storage, 'getItem' | 'setItem'> | undefined,
    private key: string,
    private job: string,
  ) {
    try {
      const raw = storage?.getItem(key);
      if (raw && raw.length <= MAX_SAVED_BYTES) {
        const value: unknown = JSON.parse(raw);
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          for (const [id, candidate] of Object.entries(value)) {
            if (!/^[a-f0-9]{64}$/.test(id) || !candidate || typeof candidate !== 'object') continue;
            const entry = candidate as Job;
            if (
              typeof entry.updatedAt !== 'number' ||
              entry.updatedAt < Date.now() - TTL ||
              entry.updatedAt > Date.now() ||
              !entry.chunks ||
              typeof entry.chunks !== 'object' ||
              Array.isArray(entry.chunks)
            )
              continue;
            this.jobs[id] = entry;
          }
        }
      }
    } catch {
      /* Private browsing and blocked storage remain memory-only. */
    }
  }

  load(index: number, digest: string, start: number, end: number): CompletedChunk | undefined {
    const value = this.jobs[this.job]?.chunks[index];
    if (
      !value ||
      value.digest !== digest ||
      value.start !== start ||
      value.end !== end ||
      typeof value.provider !== 'string'
    )
      return;
    try {
      const cues = Array.isArray(value.cues) && !value.cues.length ? [] : validateCues(value.cues);
      if (cues.some((cue) => cue.start < start || cue.end > end + 0.001)) return;
      return { ...value, cues };
    } catch {
      return;
    }
  }

  save(index: number, completed: CompletedChunk) {
    const job = this.jobs[this.job] ?? { updatedAt: Date.now(), chunks: {} };
    job.updatedAt = Date.now();
    job.chunks[index] = completed;
    this.jobs[this.job] = job;
    const entries = Object.entries(this.jobs)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, MAX_JOBS);
    this.jobs = Object.fromEntries(entries);
    try {
      let serialized = JSON.stringify(this.jobs);
      while (serialized.length > MAX_SAVED_BYTES && entries.length > 1) {
        entries.pop();
        this.jobs = Object.fromEntries(entries);
        serialized = JSON.stringify(this.jobs);
      }
      if (serialized.length <= MAX_SAVED_BYTES) this.storage?.setItem(this.key, serialized);
    } catch {
      /* Quota failures must not fail transcription. */
    }
  }
}

export async function openTranscriptionCheckpoints(file: File, scope?: string) {
  let storage: Storage | undefined;
  if (scope) {
    try {
      storage = window.sessionStorage;
    } catch {
      /* Memory-only when unavailable. */
    }
  }
  const account = scope ? await audioDigest(new TextEncoder().encode(scope).buffer) : 'memory';
  return new TranscriptionCheckpoints(storage, `${KEY}${account}`, await mediaFingerprint(file));
}
