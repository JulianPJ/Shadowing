import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkersAiTranslationProvider, myMemoryTranslation } from '../src/lib/providers/translation';
import { handleTranslationRequest } from '../src/lib/translation-api';
import { WORKERS_AI_TRANSLATION_MODEL } from '../src/lib/providers/workers-ai';

test('Workers AI translation uses the dedicated Japanese-to-English model', async () => {
  let call: { model?: string; input?: Record<string, unknown> } = {};
  const provider = createWorkersAiTranslationProvider({ async run(model, input) {
    call = { model, input };
    return { translated_text: 'I went to Kyoto with a friend.' };
  } });
  const translated = await provider.translate('友達と京都へ行きました。', new AbortController().signal);
  assert.equal(translated, 'I went to Kyoto with a friend.');
  assert.equal(call.model, WORKERS_AI_TRANSLATION_MODEL);
  assert.equal(call.model, '@cf/meta/m2m100-1.2b');
  assert.equal(call.input?.source_lang, 'japanese');
  assert.equal(call.input?.target_lang, 'english');
});

test('shared translation API validates origin/input and returns provider identity', async () => {
  const provider = { name: 'mock-translation', async translate() { return 'Good morning.'; } };
  const request = (body: unknown, origin = 'https://hibiki.test') => new Request('https://hibiki.test/api/translate', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await handleTranslationRequest(request({ japanese: 'おはようございます。' }, 'https://other.test'), provider)).status, 403);
  assert.equal((await handleTranslationRequest(request({ japanese: '' }), provider)).status, 400);
  const response = await handleTranslationRequest(request({ japanese: 'おはようございます。' }), provider);
  assert.equal(response.status, 200);
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
