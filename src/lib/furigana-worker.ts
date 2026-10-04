import { annotateJapanese, type MorphologicalToken } from './japanese-readings';

type Tokenizer = { tokenize: (text: string) => MorphologicalToken[] };
const scope = globalThis as unknown as {
  importScripts: (url: string) => void;
  kuromoji: {
    builder: (options: { dicPath: string }) => {
      build: (done: (error: unknown, tokenizer: Tokenizer) => void) => void;
    };
  };
  onmessage: (event: MessageEvent<{ id: number; text: string }>) => void;
  postMessage: (value: unknown) => void;
};
let tokenizer: Promise<Tokenizer> | undefined;
function loadTokenizer() {
  return (tokenizer ??= new Promise<Tokenizer>((resolve, reject) => {
    scope.importScripts('/furigana/v1/kuromoji.js');
    scope.kuromoji
      .builder({ dicPath: '/furigana/v1/dict/' })
      .build((error, value) => (error ? reject(error) : resolve(value)));
  }));
}
scope.onmessage = async ({ data: { id, text } }) => {
  try {
    const parser = await loadTokenizer();
    scope.postMessage({ id, tokens: annotateJapanese(text, parser.tokenize(text)) });
  } catch {
    scope.postMessage({ id, error: true });
  }
};
