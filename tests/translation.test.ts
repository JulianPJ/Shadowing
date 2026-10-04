import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkersAiTranslationProvider, myMemoryTranslation } from '../src/lib/providers/translation';
import { handleTranslationRequest } from '../src/lib/translation-api';
import { WORKERS_AI_TRANSLATION_MODEL } from '../src/lib/providers/workers-ai';

test('Workers AI translation uses Qwen in no-think mode with bounded neighboring context', async () => {
  let call: { model?: string; input?: Record<string, unknown> } = {};
  const provider = createWorkersAiTranslationProvider({ async run(model, input) {
    call = { model, input };
    return { choices: [{ finish_reason: 'stop', message: { content: "It's time for Yuyu's Japanese Podcast." } }] };
  } });
  const translated = await provider.translate(
    'ゆゆの日本語ポッドキャストのお時間です。',
    new AbortController().signal,
    { previousJapanese: 'みなさんこんにちは。', nextJapanese: '今日のテーマについて話します。' },
  );
  assert.equal(translated, "It's time for Yuyu's Japanese Podcast.");
  assert.equal(call.model, WORKERS_AI_TRANSLATION_MODEL);
  assert.equal(call.model, '@cf/qwen/qwen3-30b-a3b-fp8');
  assert.equal(call.input?.max_tokens, 800);
  assert.equal(call.input?.temperature, 0);
  const messages = call.input?.messages as Array<{ role: string; content: string }>;
  assert.match(messages[0].content, /Translate ONLY the text inside <current>/);
  assert.match(messages[0].content, /NEVER translate, quote, paraphrase, or include it/);
  assert.match(messages[1].content, /<previous>みなさんこんにちは。<\/previous>/);
  assert.match(messages[1].content, /<current>ゆゆの日本語ポッドキャストのお時間です。<\/current>/);
  assert.match(messages[1].content, /<next>今日のテーマについて話します。<\/next>/);
  assert.ok(messages[1].content.endsWith('/no_think'));
});

test('Workers AI translation accepts the direct response string shape', async () => {
  const provider = createWorkersAiTranslationProvider({ async run() {
    return { response: 'A natural translation.' };
  } });
  assert.equal(await provider.translate('自然な翻訳です。', new AbortController().signal), 'A natural translation.');
});

test('shared translation API validates origin/input, passes bounded context and returns provider identity', async () => {
  let receivedContext: unknown;
  const provider = { name: 'mock-translation', async translate(_japanese: string, _signal?: AbortSignal, context?: unknown) { receivedContext = context; return 'Good morning.'; } };
  const request = (body: unknown, origin = 'https://hibiki.test') => new Request('https://hibiki.test/api/translate', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await handleTranslationRequest(request({ japanese: 'おはようございます。' }, 'https://other.test'), provider)).status, 403);
  assert.equal((await handleTranslationRequest(request({ japanese: '' }), provider)).status, 400);
  assert.equal((await handleTranslationRequest(request({ japanese: 'おはようございます。', previousJapanese: 42 }), provider)).status, 400);
  const response = await handleTranslationRequest(request({
    japanese: 'おはようございます。',
    previousJapanese: 'みなさん、',
    nextJapanese: '今日もよろしくお願いします。',
  }), provider);
  assert.equal(response.status, 200);
  assert.deepEqual(receivedContext, { previousJapanese: 'みなさん、', nextJapanese: '今日もよろしくお願いします。' });
  assert.deepEqual(await response.json(), { translation: 'Good morning.', provider: 'mock-translation' });
});

test('translation provider failures are recoverable and never expose internals', async () => {
  const provider = { name: 'mock-failure', async translate() { throw Error('SECRET upstream'); } };
  const request = new Request('https://hibiki.test/api/translate', { method: 'POST', body: JSON.stringify({ japanese: 'こんにちは。' }) });
  const response = await handleTranslationRequest(request, provider);
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes('SECRET'), false);
});

test('MyMemory remains only a replaceable local fallback', () => {
  assert.equal(myMemoryTranslation.name, 'MyMemory');
});
