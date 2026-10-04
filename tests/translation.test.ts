import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDeepLTranslationProvider,
  myMemoryTranslation,
} from '../src/lib/providers/translation';
import { handleTranslationRequest } from '../src/lib/translation-api';

test('DeepL API Free translation sends only the current section as billable text and neighbors as context', async () => {
  let url = '';
  let init: RequestInit | undefined;
  const fakeFetch: typeof fetch = async (input, options) => {
    url = String(input);
    init = options;
    return new Response(
      JSON.stringify({
        translations: [
          { detected_source_language: 'JA', text: "It's time for Yuyu's Japanese podcast." },
        ],
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  };
  const provider = createDeepLTranslationProvider('test-key:fx', fakeFetch);
  const translated = await provider.translate(
    'ゆゆの日本語ポッドキャストのお時間です。',
    new AbortController().signal,
    { previousJapanese: 'みなさんこんにちは。', nextJapanese: '今日のテーマについて話します。' },
  );
  assert.equal(translated, "It's time for Yuyu's Japanese podcast.");
  assert.equal(provider.name, 'DeepL');
  assert.equal(url, 'https://api-free.deepl.com/v2/translate');
  assert.equal(new Headers(init?.headers).get('authorization'), 'DeepL-Auth-Key test-key:fx');
  const body = JSON.parse(String(init?.body));
  assert.deepEqual(body.text, ['ゆゆの日本語ポッドキャストのお時間です。']);
  assert.equal(body.source_lang, 'JA');
  assert.equal(body.target_lang, 'EN-US');
  assert.equal(body.context, 'みなさんこんにちは。\n今日のテーマについて話します。');
});

test('DeepL Pro keys use the Pro API endpoint', async () => {
  let url = '';
  const fakeFetch: typeof fetch = async (input) => {
    url = String(input);
    return new Response(JSON.stringify({ translations: [{ text: 'Natural translation.' }] }), {
      status: 200,
    });
  };
  const provider = createDeepLTranslationProvider('paid-key', fakeFetch);
  assert.equal(
    await provider.translate('自然な翻訳です。', new AbortController().signal),
    'Natural translation.',
  );
  assert.equal(url, 'https://api.deepl.com/v2/translate');
});

test('DeepL provider rejects upstream failures without exposing response details', async () => {
  const fakeFetch: typeof fetch = async () => new Response('SECRET upstream body', { status: 456 });
  const provider = createDeepLTranslationProvider('test-key:fx', fakeFetch);
  await assert.rejects(
    () => provider.translate('こんにちは。', new AbortController().signal),
    (error) => error instanceof Error && error.message === 'DeepL translation is unavailable.',
  );
});

test('shared translation API validates origin/input, passes bounded context and returns provider identity', async () => {
  let receivedContext: unknown;
  const provider = {
    name: 'mock-translation',
    async translate(_japanese: string, _signal?: AbortSignal, context?: unknown) {
      receivedContext = context;
      return 'Good morning.';
    },
  };
  const request = (body: unknown, origin = 'https://hibiki.test') =>
    new Request('https://hibiki.test/api/translate', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await handleTranslationRequest(
        request({ japanese: 'おはようございます。' }, 'https://other.test'),
        provider,
      )
    ).status,
    403,
  );
  assert.equal((await handleTranslationRequest(request({ japanese: '' }), provider)).status, 400);
  assert.equal(
    (
      await handleTranslationRequest(
        request({ japanese: 'おはようございます。', previousJapanese: 42 }),
        provider,
      )
    ).status,
    400,
  );
  const response = await handleTranslationRequest(
    request({
      japanese: 'おはようございます。',
      previousJapanese: 'みなさん、',
      nextJapanese: '今日もよろしくお願いします。',
    }),
    provider,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(receivedContext, {
    previousJapanese: 'みなさん、',
    nextJapanese: '今日もよろしくお願いします。',
  });
  assert.deepEqual(await response.json(), {
    translation: 'Good morning.',
    provider: 'mock-translation',
  });
});

test('translation provider failures are recoverable and never expose internals', async () => {
  const provider = {
    name: 'mock-failure',
    async translate() {
      throw Error('SECRET upstream');
    },
  };
  const request = new Request('https://hibiki.test/api/translate', {
    method: 'POST',
    body: JSON.stringify({ japanese: 'こんにちは。' }),
  });
  const response = await handleTranslationRequest(request, provider);
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes('SECRET'), false);
});

test('MyMemory remains only a replaceable local fallback', () => {
  assert.equal(myMemoryTranslation.name, 'MyMemory');
});
