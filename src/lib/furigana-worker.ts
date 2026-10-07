import { annotateJapanese, type MorphologicalToken } from './japanese-readings';

type Tokenizer = { tokenize: (text: string) => MorphologicalToken[] };
type WorkerRequest = {
  id: number;
  text: string;
  kind?: 'readings' | 'morphology';
};
const scope = globalThis as unknown as {
  importScripts: (url: string) => void;
  kuromoji: {
    builder: (options: { dicPath: string }) => {
      build: (done: (error: unknown, tokenizer: Tokenizer) => void) => void;
    };
  };
  onmessage: (event: MessageEvent<WorkerRequest>) => void;
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
function safeMorphology(token: MorphologicalToken): MorphologicalToken {
  return {
    surface_form: token.surface_form,
    ...(token.reading ? { reading: token.reading } : {}),
    ...(token.word_type ? { word_type: token.word_type } : {}),
    ...(token.basic_form ? { basic_form: token.basic_form } : {}),
    ...(token.pos ? { pos: token.pos } : {}),
    ...(token.pos_detail_1 ? { pos_detail_1: token.pos_detail_1 } : {}),
    ...(token.pos_detail_2 ? { pos_detail_2: token.pos_detail_2 } : {}),
    ...(token.pos_detail_3 ? { pos_detail_3: token.pos_detail_3 } : {}),
    ...(token.conjugated_type ? { conjugated_type: token.conjugated_type } : {}),
    ...(token.conjugated_form ? { conjugated_form: token.conjugated_form } : {}),
    ...(token.pronunciation ? { pronunciation: token.pronunciation } : {}),
  };
}
scope.onmessage = async ({ data: { id, text, kind = 'readings' } }) => {
  try {
    const parser = await loadTokenizer();
    const analyzed = parser.tokenize(text);
    scope.postMessage({
      id,
      kind,
      tokens:
        kind === 'morphology' ? analyzed.map(safeMorphology) : annotateJapanese(text, analyzed),
    });
  } catch {
    scope.postMessage({ id, kind, error: true });
  }
};
