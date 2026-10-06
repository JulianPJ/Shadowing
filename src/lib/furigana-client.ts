import {
  hasKanji,
  type JapaneseReadingToken,
  type MorphologicalToken,
} from './japanese-readings';

const LIMIT = 2000;
type RequestKind = 'readings' | 'morphology';
type PendingRequest = {
  kind: RequestKind;
  resolve: (tokens: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
type WorkerResponse = {
  id: number;
  kind: RequestKind;
  tokens?: unknown;
  error?: boolean;
};

const readingCache = new Map<string, Promise<readonly JapaneseReadingToken[]>>();
const morphologyCache = new Map<string, Promise<readonly MorphologicalToken[]>>();
const pending = new Map<number, PendingRequest>();
let worker: Worker | undefined;
let nextId = 0;

function unavailable(kind: RequestKind) {
  return new Error(kind === 'readings' ? 'Readings unavailable' : 'Japanese analysis unavailable');
}
function fail() {
  worker?.terminate();
  worker = undefined;
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(unavailable(request.kind));
  }
  pending.clear();
}
function getWorker() {
  if (!worker) {
    worker = new Worker('/furigana/v1/worker.js');
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      clearTimeout(request.timer);
      if (data.error || data.kind !== request.kind || !Array.isArray(data.tokens)) {
        request.reject(unavailable(request.kind));
        if (data.error) fail();
      } else request.resolve(data.tokens);
    };
    worker.onerror = fail;
  }
  return worker;
}
function requestTokens<T>(kind: RequestKind, text: string): Promise<readonly T[]> {
  return new Promise<readonly T[]>((resolve, reject) => {
    const parser = getWorker(),
      id = ++nextId;
    const timer = setTimeout(fail, 60000);
    pending.set(id, {
      kind,
      resolve: (tokens) => resolve(tokens as readonly T[]),
      reject,
      timer,
    });
    parser.postMessage({ id, kind, text });
  });
}
function cacheRequest<T>(
  cache: Map<string, Promise<readonly T[]>>,
  text: string,
  create: () => Promise<readonly T[]>,
) {
  const existing = cache.get(text);
  if (existing) return existing;
  const request = create();
  cache.set(text, request);
  if (cache.size > LIMIT) cache.delete(cache.keys().next().value!);
  void request.catch(() => {
    if (cache.get(text) === request) cache.delete(text);
  });
  return request;
}

export function japaneseReadings(text: string): Promise<readonly JapaneseReadingToken[]> {
  if (!hasKanji(text)) return Promise.resolve([{ text }]);
  return cacheRequest(readingCache, text, () =>
    requestTokens<JapaneseReadingToken>('readings', text),
  );
}

export function japaneseMorphology(text: string): Promise<readonly MorphologicalToken[]> {
  return cacheRequest(morphologyCache, text, () =>
    requestTokens<MorphologicalToken>('morphology', text),
  );
}
