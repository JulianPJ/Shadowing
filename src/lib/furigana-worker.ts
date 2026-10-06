import type { MorphologicalToken } from './japanese-readings';

type LinderaToken = {
  surface?: string;
  wordId?: number;
  details?: string[];
  toJSON?: () => {
    surface?: string;
    wordId?: number;
    details?: string[];
  };
};

type LinderaTokenizer = {
  tokenize: (text: string) => LinderaToken[];
};

type LinderaModule = {
  default: () => Promise<unknown>;
  TokenizerBuilder: new () => {
    setDictionary: (dictionary: string) => void;
    setMode: (mode: string) => void;
    build: () => LinderaTokenizer;
  };
};

type WorkerRequest = {
  id: number;
  texts: string[];
};

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<WorkerRequest>) => void;
  postMessage: (value: unknown) => void;
};

let tokenizer: Promise<LinderaTokenizer> | undefined;

function detail(value: unknown) {
  return typeof value === 'string' && value && value !== '*' && value !== 'UNK'
    ? value
    : undefined;
}

function morphology(token: LinderaToken): MorphologicalToken {
  const raw = token.toJSON?.() ?? token;
  const details = Array.isArray(raw.details) ? raw.details : [];
  const surface = typeof raw.surface === 'string' ? raw.surface : '';
  const basicForm = detail(details[6]);
  const reading = detail(details[7]);
  const pronunciation = detail(details[8]);
  const pos = detail(details[0]);
  const known = !!(basicForm || reading || pronunciation) && pos !== 'UNK';

  return {
    surface_form: surface,
    word_type: known ? 'KNOWN' : 'UNKNOWN',
    ...(basicForm ? { basic_form: basicForm } : {}),
    ...(reading ? { reading } : {}),
    ...(pronunciation ? { pronunciation } : {}),
    ...(pos ? { pos } : {}),
    ...(detail(details[1]) ? { pos_detail_1: detail(details[1]) } : {}),
    ...(detail(details[2]) ? { pos_detail_2: detail(details[2]) } : {}),
    ...(detail(details[3]) ? { pos_detail_3: detail(details[3]) } : {}),
    ...(detail(details[4]) ? { conjugated_type: detail(details[4]) } : {}),
    ...(detail(details[5]) ? { conjugated_form: detail(details[5]) } : {}),
  };
}

async function loadTokenizer() {
  return (tokenizer ??= (async () => {
    // Keep the prebuilt Rust/WASM package outside the Next/vinext server bundle.
    // prepare-furigana.mjs copies the package next to this worker as static assets.
    const moduleUrl = '/furigana/v2/lindera_wasm.js';
    const lindera = (await import(moduleUrl)) as LinderaModule;
    await lindera.default();
    const builder = new lindera.TokenizerBuilder();
    builder.setDictionary('embedded://ipadic');
    builder.setMode('normal');
    return builder.build();
  })());
}

scope.onmessage = async ({ data: { id, texts } }) => {
  try {
    if (!Array.isArray(texts) || texts.some((text) => typeof text !== 'string'))
      throw new Error('Invalid Japanese analysis request.');

    const parser = await loadTokenizer();
    const batches = texts.map((text) => {
      const analyzed = parser.tokenize(text).map(morphology);
      if (analyzed.map((token) => token.surface_form).join('') !== text)
        throw new Error('Japanese tokenizer did not preserve source text.');
      return analyzed;
    });
    scope.postMessage({ id, batches, engine: 'lindera-wasm' });
  } catch {
    // The client transparently retries the same batch in the Kuromoji fallback worker.
    scope.postMessage({ id, error: true, engine: 'lindera-wasm' });
  }
};
