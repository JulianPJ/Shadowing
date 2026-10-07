import { FURIGANA_GENERATOR_VERSION, type MorphologicalToken } from './japanese-readings';
import {
  JAPANESE_BATCH_MAX_CHARACTERS,
  JAPANESE_BATCH_MAX_ITEMS,
  type JapaneseWorkerResponse,
} from './japanese-analysis-protocol';

export type JapaneseAnalysis = Readonly<{ tokens: readonly MorphologicalToken[] }>;
export type JapaneseAnalysisOptions = {
  signal?: AbortSignal;
  priority?: 'interactive' | 'background';
};
export type JapaneseAnalysisInput = Readonly<{ id: string; text: string }>;
type Entry = {
  id: number;
  key: string;
  text: string;
  promise: Promise<JapaneseAnalysis>;
  resolve: (analysis: JapaneseAnalysis) => void;
  reject: (error: Error) => void;
  priority: 'interactive' | 'background';
  state: 'queued' | 'active' | 'settled';
  retained: boolean;
  consumers: Set<symbol>;
};
type ActiveBatch = {
  id: number;
  entries: Entry[];
  timer: ReturnType<typeof setTimeout>;
};

const CACHE_MAX_ITEMS = 2000;
const CACHE_MAX_CHARACTERS = 250000;
const cache = new Map<string, Entry>();
const inFlight = new Map<string, Entry>();
const interactiveQueue = new Map<number, Entry>();
const backgroundQueue = new Map<number, Entry>();
let cachedCharacters = 0;
let worker: Worker | undefined;
let active: ActiveBatch | undefined;
let nextId = 0;
let scheduled = false;

const unavailable = () => new Error('Japanese analysis unavailable');
const cancelled = () => new Error('Japanese analysis was cancelled.');

function fail() {
  worker?.terminate();
  worker = undefined;
  if (active) clearTimeout(active.timer);
  active = undefined;
  for (const entry of inFlight.values()) {
    entry.state = 'settled';
    entry.reject(unavailable());
  }
  inFlight.clear();
  interactiveQueue.clear();
  backgroundQueue.clear();
}

function remember(entry: Entry, tokens: readonly MorphologicalToken[]) {
  entry.state = 'settled';
  inFlight.delete(entry.key);
  // LRU and a source-character budget bound retained token arrays, not just entry count.
  if (entry.text.length <= CACHE_MAX_CHARACTERS) {
    cache.set(entry.key, entry);
    cachedCharacters += entry.text.length;
    while (cache.size > CACHE_MAX_ITEMS || cachedCharacters > CACHE_MAX_CHARACTERS) {
      const oldest = cache.keys().next().value!;
      cachedCharacters -= cache.get(oldest)!.text.length;
      cache.delete(oldest);
    }
  }
  entry.resolve({ tokens });
}

function validTokens(value: unknown): value is readonly MorphologicalToken[] {
  return (
    Array.isArray(value) &&
    value.every(
      (token) =>
        token &&
        typeof token === 'object' &&
        typeof token.surface_form === 'string' &&
        [
          'reading',
          'word_type',
          'basic_form',
          'pos',
          'pos_detail_1',
          'pos_detail_2',
          'pos_detail_3',
          'conjugated_type',
          'conjugated_form',
          'pronunciation',
        ].every((field) => token[field] === undefined || typeof token[field] === 'string'),
    )
  );
}

function getWorker() {
  if (!worker) {
    const parser = new Worker('/furigana/v1/worker.js');
    worker = parser;
    parser.onerror = () => {
      if (worker === parser) fail();
    };
    parser.onmessage = ({ data }: MessageEvent<JapaneseWorkerResponse>) => {
      if (worker !== parser) return;
      if (!data || typeof data !== 'object') {
        if (active) fail();
        return;
      }
      if (!active || data.id !== active.id) return;
      const batch = active;
      const results =
        batch.entries.length === 1 && data.kind !== 'morphology-batch'
          ? [{ id: batch.entries[0].id, tokens: data.tokens, error: data.error }]
          : data.kind === 'morphology-batch' && Array.isArray(data.results)
            ? data.results
            : [];
      if (
        results.some(
          (result) => !result || typeof result !== 'object' || typeof result.id !== 'number',
        )
      ) {
        fail();
        return;
      }
      const resultById = new Map(results.map((result) => [result.id, result]));
      if (
        data.error ||
        (data.kind !== undefined &&
          data.kind !== 'morphology' &&
          data.kind !== 'morphology-batch') ||
        results.length !== batch.entries.length ||
        resultById.size !== batch.entries.length ||
        batch.entries.some((entry) => {
          const result = resultById.get(entry.id);
          return !result || result.error || !validTokens(result.tokens);
        })
      ) {
        fail();
        return;
      }
      clearTimeout(batch.timer);
      active = undefined;
      for (const entry of batch.entries) remember(entry, resultById.get(entry.id)!.tokens!);
      schedule();
    };
  }
  return worker;
}

function flush() {
  scheduled = false;
  if (active || (interactiveQueue.size === 0 && backgroundQueue.size === 0)) return;
  const selected = interactiveQueue.size > 0 ? interactiveQueue : backgroundQueue;
  const entries: Entry[] = [];
  let characters = 0;
  for (const entry of selected.values()) {
    if (
      entries.length > 0 &&
      (entries.length >= JAPANESE_BATCH_MAX_ITEMS ||
        characters + entry.text.length > JAPANESE_BATCH_MAX_CHARACTERS)
    )
      break;
    entries.push(entry);
    characters += entry.text.length;
    entry.state = 'active';
    selected.delete(entry.id);
  }
  const id = ++nextId;
  active = { id, entries, timer: setTimeout(fail, 60000) };
  try {
    const parser = getWorker();
    parser.postMessage(
      entries.length === 1
        ? { id, kind: 'morphology', text: entries[0].text }
        : {
            id,
            kind: 'morphology-batch',
            items: entries.map((entry) => ({ id: entry.id, text: entry.text })),
          },
    );
  } catch {
    fail();
  }
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(flush);
}

function subscribe(entry: Entry, signal?: AbortSignal): Promise<JapaneseAnalysis> {
  if (!signal) {
    entry.retained = true;
    return entry.promise;
  }
  const consumer = Symbol();
  entry.consumers.add(consumer);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      entry.consumers.delete(consumer);
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(cancelled());
      if (entry.state === 'queued' && !entry.retained && entry.consumers.size === 0) {
        interactiveQueue.delete(entry.id);
        backgroundQueue.delete(entry.id);
        inFlight.delete(entry.key);
        entry.state = 'settled';
        entry.reject(cancelled());
      }
    };
    signal.addEventListener('abort', abort, { once: true });
    void entry.promise.then(
      (analysis) => {
        cleanup();
        if (!signal.aborted) resolve(analysis);
        else reject(cancelled());
      },
      (error: Error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/** Exact source identity: never trim or join neighboring subtitle sections. */
export function analyzeJapanese(
  text: string,
  options: JapaneseAnalysisOptions = {},
): Promise<JapaneseAnalysis> {
  if (options.signal?.aborted) return Promise.reject(cancelled());
  const key = `${FURIGANA_GENERATOR_VERSION}:${text}`;
  let entry = cache.get(key) ?? inFlight.get(key);
  if (entry && cache.has(key)) {
    cache.delete(key);
    cache.set(key, entry);
  }
  if (!entry) {
    let resolve!: Entry['resolve'];
    let reject!: Entry['reject'];
    const promise = new Promise<JapaneseAnalysis>((done, failed) => {
      resolve = done;
      reject = failed;
    });
    entry = {
      id: ++nextId,
      key,
      text,
      promise,
      resolve,
      reject,
      priority: options.priority ?? 'interactive',
      state: 'queued',
      retained: false,
      consumers: new Set(),
    };
    inFlight.set(key, entry);
    (entry.priority === 'interactive' ? interactiveQueue : backgroundQueue).set(entry.id, entry);
  } else if (options.priority !== 'background' && entry.priority !== 'interactive') {
    entry.priority = 'interactive';
    if (entry.state === 'queued') {
      backgroundQueue.delete(entry.id);
      interactiveQueue.set(entry.id, entry);
    }
  }
  const result = subscribe(entry, options.signal);
  schedule();
  return result;
}

/** Stable IDs and ordered results, with cancellation and an event-loop yield between windows. */
export async function analyzeJapaneseBatch(
  items: readonly JapaneseAnalysisInput[],
  options: JapaneseAnalysisOptions = {},
): Promise<readonly (JapaneseAnalysis & { id: string })[]> {
  const results: (JapaneseAnalysis & { id: string })[] = [];
  for (let start = 0; start < items.length;) {
    if (options.signal?.aborted) throw cancelled();
    const window: JapaneseAnalysisInput[] = [];
    let characters = 0;
    do {
      const item = items[start++];
      window.push(item);
      characters += item.text.length;
    } while (
      start < items.length &&
      window.length < JAPANESE_BATCH_MAX_ITEMS &&
      characters + items[start].text.length <= JAPANESE_BATCH_MAX_CHARACTERS
    );
    results.push(
      ...(await Promise.all(
        window.map(async (item) => ({
          id: item.id,
          ...(await analyzeJapanese(item.text, {
            ...options,
            priority: options.priority ?? 'background',
          })),
        })),
      )),
    );
    if (start < items.length) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (options.signal?.aborted) throw cancelled();
  return results;
}
