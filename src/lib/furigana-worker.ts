import { runJapaneseWorkerRequest, type JapaneseTokenizer } from './japanese-analysis-worker';
import type { JapaneseWorkerRequest } from './japanese-analysis-protocol';
const scope = globalThis as unknown as {
  importScripts: (url: string) => void;
  kuromoji: {
    builder: (options: { dicPath: string }) => {
      build: (done: (error: unknown, tokenizer: JapaneseTokenizer) => void) => void;
    };
  };
  onmessage: (event: MessageEvent<JapaneseWorkerRequest>) => void;
  postMessage: (value: unknown) => void;
};
let tokenizer: Promise<JapaneseTokenizer> | undefined;
function loadTokenizer() {
  return (tokenizer ??= new Promise<JapaneseTokenizer>((resolve, reject) => {
    scope.importScripts('/furigana/v1/kuromoji.js');
    scope.kuromoji
      .builder({ dicPath: '/furigana/v1/dict/' })
      .build((error, value) => (error ? reject(error) : resolve(value)));
  }));
}
scope.onmessage = async ({ data }) => {
  scope.postMessage(await runJapaneseWorkerRequest(data, loadTokenizer));
};
