import { hasKanji, type JapaneseReadingToken } from './japanese-readings';

const LIMIT = 2000;
const cache = new Map<string, Promise<readonly JapaneseReadingToken[]>>();
const pending = new Map<
  number,
  {
    resolve: (tokens: readonly JapaneseReadingToken[]) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
let worker: Worker | undefined;
let nextId = 0;
function fail() {
  worker?.terminate();
  worker = undefined;
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error('Readings unavailable'));
  }
  pending.clear();
}
function getWorker() {
  if (!worker) {
    worker = new Worker('/furigana/v1/worker.js');
    worker.onmessage = ({
      data,
    }: MessageEvent<{ id: number; tokens: JapaneseReadingToken[]; error?: boolean }>) => {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      clearTimeout(request.timer);
      if (data.error) {
        request.reject(new Error('Readings unavailable'));
        fail();
      } else request.resolve(data.tokens);
    };
    worker.onerror = fail;
  }
  return worker;
}
export function japaneseReadings(text: string): Promise<readonly JapaneseReadingToken[]> {
  if (!hasKanji(text)) return Promise.resolve([{ text }]);
  const existing = cache.get(text);
  if (existing) return existing;
  const request = new Promise<readonly JapaneseReadingToken[]>((resolve, reject) => {
    const parser = getWorker(),
      id = ++nextId;
    const timer = setTimeout(fail, 60000);
    pending.set(id, { resolve, reject, timer });
    parser.postMessage({ id, text });
  });
  cache.set(text, request);
  if (cache.size > LIMIT) cache.delete(cache.keys().next().value!);
  // A later off/on toggle can retry after unavailable assets or offline initialization.
  void request.catch(() => {
    if (cache.get(text) === request) cache.delete(text);
  });
  return request;
}
