// Deterministic integration check of the actual production bundle in local workerd.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Miniflare, convertV4MiniflareOptions, Response } from 'miniflare';

const root = path.resolve('.cloudflare/output/v0/workers/default/bundle');
let captions = 0;
const emails = [];
const billingId = (prefix) => `${prefix}_${'a'.repeat(26)}`;
let billingTransaction;
const cues = Array.from({ length: 6 }, (_, i) => ({
  start: i * 8,
  end: i * 8 + 7,
  text: `今日は日本語の勉強について詳しく話します。毎日練習すると少しずつ上手になります。${i}。`,
}));
const options = convertV4MiniflareOptions({
  workers: [
    {
      name: 'shadowing',
      modules: true,
      scriptPath: path.join(root, 'index.js'),
      modulesRoot: root,
      compatibilityDate: '2026-10-03',
      compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
      d1Databases: { HIBIKI_DB: 'runtime-test' },
      ratelimits: {
        SHADOWING_AI_RATE_LIMIT: { namespace_id: '19001', simple: { limit: 6, period: 60 } },
        DISCOVERY_RATE_LIMIT: { namespace_id: '19002', simple: { limit: 90, period: 60 } },
        PUBLIC_API_RATE_LIMIT: { namespace_id: '19003', simple: { limit: 60, period: 60 } },
        BILLING_RATE_LIMIT: { namespace_id: '19004', simple: { limit: 10, period: 60 } },
      },
      serviceBindings: { AI: 'ai-mock' },
      bindings: {
        AUTH_BASE_URL: 'https://example.com',
        AUTH_SECRET: 'deterministic-worker-test-secret-32-characters',
        RESEND_API_KEY: 'mock-email-key',
        AUTH_EMAIL_FROM: 'Hibiki <noreply@example.com>',
        YOUTUBE_CAPTION_RELAY_URL: 'https://relay.example',
        YOUTUBE_CAPTION_RELAY_TOKEN: 'mock-test-token',
        PADDLE_ENABLED: 'true',
        PADDLE_ENVIRONMENT: 'sandbox',
        PADDLE_API_KEY: 'mock-server-paddle-key',
        PADDLE_WEBHOOK_SECRET: 'mock-server-paddle-webhook-secret',
        PADDLE_CLIENT_TOKEN: 'test_mock-public-paddle-token',
        PADDLE_PRO_MONTHLY_PRICE_ID: billingId('pri'),
        PADDLE_PRO_ANNUAL_PRICE_ID: `pri_${'b'.repeat(26)}`,
      },
      outboundService: async (request) => {
        const url = new URL(request.url);
        if (url.hostname === 'sandbox-api.paddle.com') {
          assert.equal(request.headers.get('Authorization'), 'Bearer mock-server-paddle-key');
          if (url.pathname === '/transactions' && request.method === 'POST') {
            billingTransaction = {
              ...(await request.json()),
              id: billingId('txn'),
              customer_id: billingId('ctm'),
              subscription_id: billingId('sub'),
            };
            return Response.json({ data: billingTransaction });
          }
          if (url.pathname === `/transactions/${billingId('txn')}`)
            return Response.json({ data: billingTransaction });
          if (url.pathname === `/customers/${billingId('ctm')}/portal-sessions`)
            return Response.json({
              data: {
                urls: {
                  general: {
                    overview: 'https://sandbox-customer-portal.paddle.com/session?token=mock',
                  },
                },
              },
            });
        }
        if (url.hostname === 'api.resend.com') {
          emails.push(await request.json());
          return Response.json({ id: 'mock-message' });
        }
        if (url.hostname === 'www.youtube.com' && url.pathname === '/oembed')
          return Response.json({ title: 'Runtime fixture', author_name: 'Mock provider' });
        if (url.hostname === 'relay.example' && url.pathname === '/captions') {
          captions++;
          if (captions > 1) throw new Error('Caption acquisition must be bypassed');
          return Response.json({
            videoId: 'IJ6R4u05ppw',
            language: 'ja',
            cues,
            provider: 'mock-captions',
          });
        }
        throw new Error('Unmocked network access');
      },
    },
    {
      name: 'ai-mock',
      modules: true,
      compatibilityDate: '2026-10-03',
      script: `import { WorkerEntrypoint } from 'cloudflare:workers';
      let calls = {quiz:0,difficulty:0,transcription:0};
      export default class extends WorkerEntrypoint {
        async fetch() { return Response.json(calls); }
        async run(model,input) {
          if (model.includes('whisper')) {
            calls.transcription++;
            return {text:'日本語です。',vtt:'WEBVTT\\n\\n00:00:00.000 --> 00:00:01.000\\n日本語です。'};
          }
          if (model.includes('qwen')) {
            if (++calls.quiz > 1) throw new Error('Quiz inference must be bypassed');
            const content=input.messages.find(m=>m.role==='user').content;
            const segments=JSON.parse(content.slice(content.indexOf('{'),content.lastIndexOf('}')+1)).segments;
            return {response:{questions:segments.slice(0,3).map((s,i)=>({kind:'detail',question:'何について話しますか'+i+'？',options:['日本語','英語','数学','料理'],correctIndex:0,explanation:'The speaker discusses Japanese practice.',evidence:{segmentIds:[s.id]}}))}};
          }
          if (++calls.difficulty > 1) throw new Error('Difficulty inference must be bypassed');
          return {answers:Object.fromEntries(Object.entries({overall:'n4_n3',vocabulary:'intermediate',grammar:'elementary',conversation:'intermediate'}).map(([key,choice])=>[key,{type:'choice',choice,confidence:0.5,probabilities:{[choice]:1}}]))};
        }
      }`,
    },
  ],
});
const modules = {};
for (const file of await readdir(root, { recursive: true, withFileTypes: true })) {
  if (!file.isFile()) continue;
  const absolute = path.join(file.parentPath, file.name);
  const name = path.relative(root, absolute).replaceAll('\\', '/');
  const type = name.endsWith('.js') ? 'esm' : name.endsWith('.json') ? 'json' : 'data';
  modules[name] = {
    type,
    contents: await readFile(absolute, type === 'data' ? undefined : 'utf8'),
  };
}
options.workers[0].config.manifest = { mainModule: 'index.js', modulesRoot: root, modules };
const mf = new Miniflare(options);
try {
  const db = await mf.getD1Database('HIBIKI_DB', 'shadowing');
  for (const file of (await readdir('migrations')).sort()) {
    const migration = await readFile(`migrations/${file}`, 'utf8');
    await db.batch(
      migration
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => db.prepare(s)),
    );
  }
  const register = await mf.dispatchFetch('https://example.com/api/auth/sign-up/email', {
    method: 'POST',
    headers: {
      Origin: 'https://example.com',
      'Content-Type': 'application/json',
      'cf-connecting-ip': '192.0.2.10',
    },
    body: JSON.stringify({
      email: 'runtime@example.com',
      password: 'runtime test password',
      name: 'Runtime learner',
      callbackURL: '/account',
    }),
  });
  assert.equal(register.status, 200, `Worker registration failed (status ${register.status})`);
  for (let i = 0; i < 50 && !emails.length; i++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(emails.length, 1);
  const link = emails[0].text.slice(emails[0].text.indexOf('https://'));
  const verification = await mf.dispatchFetch(link, { redirect: 'manual' });
  assert.equal(verification.status, 302, await verification.clone().text());
  const cookie = verification.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  assert.ok(cookie.includes('session_token='));
  const me = await mf.dispatchFetch('https://example.com/api/account/me', {
    headers: { Cookie: cookie },
  });
  const identity = await me.json();
  assert.equal(identity.user.email, 'runtime@example.com');
  assert.equal(identity.user.plan, 'free');

  // Exercise the built route handlers, egress, Web Crypto verification and D1 projection together.
  const billingHeaders = {
    Cookie: cookie,
    Origin: 'https://example.com',
    'Content-Type': 'application/json',
    'X-Hibiki-Account': identity.user.id,
    'cf-connecting-ip': '192.0.2.30',
  };
  const checkout = await mf.dispatchFetch('https://example.com/api/billing/checkout', {
    method: 'POST',
    headers: billingHeaders,
    body: JSON.stringify({ interval: 'monthly' }),
  });
  assert.equal(checkout.status, 200, await checkout.clone().text());
  assert.equal((await checkout.json()).transactionId, billingId('txn'));
  assert.equal(
    (
      await (
        await mf.dispatchFetch('https://example.com/api/account/me', {
          headers: { Cookie: cookie },
        })
      ).json()
    ).user.plan,
    'free',
  );
  const billingTime = Date.now();
  const billingEvent = {
    event_id: billingId('evt'),
    event_type: 'subscription.activated',
    occurred_at: new Date(billingTime).toISOString(),
    data: {
      id: billingId('sub'),
      customer_id: billingId('ctm'),
      status: 'active',
      collection_mode: 'automatic',
      custom_data: billingTransaction.custom_data,
      items: [
        {
          price: { id: billingId('pri'), billing_cycle: { interval: 'month', frequency: 1 } },
          quantity: 1,
        },
      ],
      current_billing_period: {
        starts_at: new Date(billingTime - 1000).toISOString(),
        ends_at: new Date(billingTime + 30 * 86400_000).toISOString(),
      },
    },
  };
  async function sendBillingEvent(event) {
    const body = JSON.stringify(event),
      timestamp = Math.floor(Date.now() / 1000);
    const { createHmac } = await import('node:crypto');
    const signature = createHmac('sha256', 'mock-server-paddle-webhook-secret')
      .update(`${timestamp}:${body}`)
      .digest('hex');
    return mf.dispatchFetch('https://example.com/api/billing/webhook', {
      method: 'POST',
      headers: { 'Paddle-Signature': `ts=${timestamp};h1=${signature}` },
      body,
    });
  }
  const forgedWebhook = await mf.dispatchFetch('https://example.com/api/billing/webhook', {
    method: 'POST',
    body: JSON.stringify(billingEvent),
  });
  assert.equal(forgedWebhook.status, 401);
  const activation = await sendBillingEvent(billingEvent);
  assert.equal(activation.status, 200, await activation.clone().text());
  assert.equal((await sendBillingEvent(billingEvent)).status, 200);
  assert.equal(
    (
      await (
        await mf.dispatchFetch('https://example.com/api/account/me', {
          headers: { Cookie: cookie },
        })
      ).json()
    ).user.plan,
    'pro',
  );
  const portal = await mf.dispatchFetch('https://example.com/api/billing/portal', {
    method: 'POST',
    headers: billingHeaders,
    body: '{}',
  });
  assert.equal(portal.status, 200, await portal.clone().text());
  assert.equal(portal.headers.get('Cache-Control'), 'no-store');
  const canceled = await sendBillingEvent({
    ...billingEvent,
    event_id: `evt_${'b'.repeat(26)}`,
    event_type: 'subscription.canceled',
    occurred_at: new Date(billingTime + 1).toISOString(),
    data: { ...billingEvent.data, status: 'canceled', current_billing_period: null },
  });
  assert.equal(canceled.status, 200, await canceled.clone().text());
  assert.equal(
    (
      await (
        await mf.dispatchFetch('https://example.com/api/account/me', {
          headers: { Cookie: cookie },
        })
      ).json()
    ).user.plan,
    'free',
  );
  await db.prepare('DELETE FROM user_access WHERE user_id=?').bind(identity.user.id).run();

  const freeDictionary = await mf.dispatchFetch('https://example.com/api/dictionary', {
    headers: { Cookie: cookie },
  });
  assert.equal(freeDictionary.status, 403);
  assert.equal((await freeDictionary.json()).code, 'pro-required');
  for (const endpoint of [
    'translate',
    'difficulty',
    'quiz',
    'transcribe',
    'shadowing/transcribe',
    'shadowing/feedback',
    'shadowing/summary',
    'dictionary',
    'review',
    'knowledge',
  ]) {
    for (const signedIn of [false, true]) {
      const response = await mf.dispatchFetch('https://example.com/api/' + endpoint, {
        method: 'POST',
        headers: {
          ...(signedIn ? { Cookie: cookie } : {}),
          Origin: 'https://example.com',
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      assert.equal(response.status, signedIn ? 403 : 401, endpoint);
    }
  }
  assert.equal((await mf.dispatchFetch('https://example.com/api/knowledge')).status, 401);
  await db
    .prepare('INSERT INTO user_access (user_id,plan,source,updated_at) VALUES (?,?,?,?)')
    .bind(identity.user.id, 'pro', 'test', new Date().toISOString())
    .run();

  const knowledgeHeaders = {
    Cookie: cookie,
    Origin: 'https://example.com',
    'Content-Type': 'application/json',
    'X-Hibiki-Account': identity.user.id,
  };
  const wordState = {
    lemma: '勉強',
    reading: 'べんきょう',
    state: 'known',
    updatedAt: new Date().toISOString(),
  };
  const savedWord = await mf.dispatchFetch('https://example.com/api/knowledge', {
    method: 'POST',
    headers: knowledgeHeaders,
    body: JSON.stringify({ records: [wordState] }),
  });
  assert.equal(savedWord.status, 200);
  const wordPage = await mf.dispatchFetch('https://example.com/api/knowledge', {
    headers: { Cookie: cookie, 'X-Hibiki-Account': identity.user.id },
  });
  assert.deepEqual((await wordPage.json()).records, [wordState]);
  assert.equal(
    (
      await mf.dispatchFetch('https://example.com/api/knowledge', {
        headers: { Cookie: cookie, 'X-Hibiki-Account': 'someone-else' },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await mf.dispatchFetch('https://example.com/api/knowledge', {
        method: 'POST',
        headers: { ...knowledgeHeaders, Origin: 'https://evil.example' },
        body: JSON.stringify({ records: [wordState] }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await db
        .prepare('SELECT COUNT(*) AS n FROM user_word_knowledge WHERE user_id=?')
        .bind(identity.user.id)
        .first()
    ).n,
    1,
  );
  const upgraded = await mf.dispatchFetch('https://example.com/api/account/me', {
    headers: { Cookie: cookie },
  });
  assert.equal((await upgraded.json()).user.plan, 'pro');

  // Bounded browser-prepared audio follows the same Pro gate and existing rate binding.
  const audio = new Uint8Array(44 + 32000);
  const audioView = new DataView(audio.buffer);
  for (const [offset, value] of [
    [0, 'RIFF'],
    [8, 'WAVE'],
    [12, 'fmt '],
    [36, 'data'],
  ])
    [...value].forEach((character, index) => (audio[offset + index] = character.charCodeAt(0)));
  audioView.setUint32(4, audio.length - 8, true);
  audioView.setUint32(16, 16, true);
  audioView.setUint16(20, 1, true);
  audioView.setUint16(22, 1, true);
  audioView.setUint32(24, 16000, true);
  audioView.setUint32(28, 32000, true);
  audioView.setUint16(32, 2, true);
  audioView.setUint16(34, 16, true);
  audioView.setUint32(40, 32000, true);
  for (let attempt = 0; attempt < 7; attempt++) {
    const response = await mf.dispatchFetch('https://example.com/api/transcribe', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: 'https://example.com',
        'Content-Type': 'audio/wav',
        'X-Hibiki-Audio-Chunk': '1',
        'cf-connecting-ip': '192.0.2.20',
      },
      body: audio,
    });
    assert.equal(response.status, attempt < 6 ? 200 : 429);
    if (attempt < 6) assert.equal((await response.json()).cues[0].text, '日本語です。');
    else assert.equal(response.headers.get('Retry-After'), '60');
  }

  const sync = {
    preferences: {
      schemaVersion: 1,
      mode: 'continuous',
      speed: 0.75,
      studioMode: true,
      furigana: true,
      reviewLimits: {
        defaults: { new: 20, review: 100 },
        decks: { inbox: { new: 5, review: 25 } },
      },
      updatedAt: new Date().toISOString(),
    },
    lessons: [],
    sessions: [],
    attempts: [],
    bookmarks: [],
    difficulties: [],
    archives: [],
  };
  const saved = await mf.dispatchFetch('https://example.com/api/sync/push', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: 'https://example.com', 'Content-Type': 'application/json' },
    body: JSON.stringify(sync),
  });
  assert.equal(saved.status, 200);
  const limits = await db
    .prepare('SELECT review_limits_json FROM user_preferences WHERE user_id=?')
    .bind(identity.user.id)
    .first();
  assert.deepEqual(JSON.parse(limits.review_limits_json), sync.preferences.reviewLimits);
  const restoredPreferences = await mf.dispatchFetch('https://example.com/api/sync/bootstrap', {
    headers: { Cookie: cookie },
  });
  assert.equal(restoredPreferences.status, 200);
  assert.deepEqual(
    (await restoredPreferences.json()).data.preferences.reviewLimits,
    sync.preferences.reviewLimits,
  );
  assert.equal(
    (
      await db
        .prepare('SELECT furigana FROM user_preferences WHERE user_id=?')
        .bind(identity.user.id)
        .first()
    ).furigana,
    1,
  );
  const dictionaryEntry = {
    schemaVersion: 1,
    term: '勉強',
    reading: 'べんきょう',
    translation: 'study',
    sourceSentence: '日本語を勉強しています。',
    sourceSentenceTranslation: 'I am studying Japanese.',
    source: {
      lessonId: 'youtube:IJ6R4u05ppw',
      segmentId: 'segment-runtime',
      lessonTitle: 'Runtime fixture',
      lessonAuthor: 'Mock provider',
      mediaType: 'youtube',
      mediaId: 'IJ6R4u05ppw',
      mediaUrl: 'https://www.youtube.com/watch?v=IJ6R4u05ppw',
      mediaContentKey: 'youtube:IJ6R4u05ppw',
      transcriptKey: 'a'.repeat(64),
      start: 12.5,
      end: 16.2,
    },
  };
  const dictionarySaved = await mf.dispatchFetch('https://example.com/api/dictionary', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: 'https://example.com', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'save', entry: dictionaryEntry }),
  });
  assert.equal(
    dictionarySaved.status,
    200,
    `Dictionary save failed: ${await dictionarySaved.clone().text()}`,
  );
  const dictionaryPayload = await dictionarySaved.json();
  assert.equal(dictionaryPayload.entry.term, '勉強');
  assert.equal(dictionaryPayload.entry.source.start, 12.5);
  assert.equal(
    (
      await db
        .prepare('SELECT COUNT(*) AS n FROM user_dictionary_entries WHERE user_id=?')
        .bind(identity.user.id)
        .first()
    ).n,
    1,
  );
  const dictionaryList = await mf.dispatchFetch('https://example.com/api/dictionary', {
    headers: { Cookie: cookie },
  });
  assert.equal(dictionaryList.status, 200);
  assert.equal((await dictionaryList.json()).entries.length, 1);
  const reviewHeaders = {
    Cookie: cookie,
    Origin: 'https://example.com',
    'Content-Type': 'application/json',
  };
  const entryId = dictionaryPayload.entry.id;
  const exact = await mf.dispatchFetch('https://example.com/api/dictionary?ids=' + entryId, {
    headers: { Cookie: cookie },
  });
  assert.equal(exact.status, 200);
  assert.equal((await exact.json()).entries[0].id, entryId);
  // Tags were removed; their route no longer exists.
  assert.equal(
    (await mf.dispatchFetch('https://example.com/api/tags', { headers: { Cookie: cookie } }))
      .status,
    404,
  );
  assert.equal(
    (
      await mf.dispatchFetch('https://example.com/api/dictionary?limit=101', {
        headers: { Cookie: cookie },
      })
    ).status,
    400,
  );
  const enrolledAt = new Date().toISOString();
  const enrolled = await mf.dispatchFetch('https://example.com/api/review', {
    method: 'POST',
    headers: reviewHeaders,
    body: JSON.stringify({ action: 'enroll', entryIds: [entryId], enrolledAt }),
  });
  assert.equal(enrolled.status, 200);
  const reviewSnapshot = await mf.dispatchFetch('https://example.com/api/review', {
    headers: { Cookie: cookie },
  });
  const reviewData = await reviewSnapshot.json();
  assert.equal(reviewData.cards.length, 1);
  assert.equal(reviewData.cards[0].entryId, entryId);
  const grade = {
    action: 'grade',
    entryId,
    revision: 0,
    grade: 'good',
    reviewedAt: new Date().toISOString(),
    operationId: crypto.randomUUID(),
  };
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await mf.dispatchFetch('https://example.com/api/review', {
          method: 'POST',
          headers: reviewHeaders,
          body: JSON.stringify(grade),
        })
      ).status,
      200,
    );
  const graded = await (
    await mf.dispatchFetch('https://example.com/api/review', { headers: { Cookie: cookie } })
  ).json();
  assert.equal(graded.cards[0].revision, 1);
  assert.equal(graded.cards[0].intervalDays, 0);
  assert.equal(graded.cards[0].status, 'learning');
  assert.equal(graded.cards[0].repetitions, 1);
  assert.equal(Date.parse(graded.cards[0].dueAt) - Date.parse(grade.reviewedAt), 600_000);
  assert.deepEqual(graded.history, [
    {
      operationId: grade.operationId,
      entryId,
      grade: 'good',
      status: 'new',
      reviewedAt: grade.reviewedAt,
    },
  ]);
  assert.ok(Number.isFinite(Date.parse(graded.historySince)));
  assert.ok(Number.isFinite(Date.parse(graded.historyWindowStart)));
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  assert.equal((await mf.dispatchFetch('https://example.com/api/review')).status, 401);
  assert.equal(
    (
      await mf.dispatchFetch('https://example.com/api/review', {
        headers: { Cookie: cookie, 'X-Hibiki-Account': 'another-user' },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await mf.dispatchFetch('https://example.com/api/review', {
        method: 'POST',
        headers: { ...reviewHeaders, Origin: 'https://evil.example' },
        body: JSON.stringify(grade),
      })
    ).status,
    403,
  );
  // Expiry preserves vocabulary/reviews/knowledge; raw export stays available on Free.
  await db
    .prepare("UPDATE user_access SET plan='free' WHERE user_id=?")
    .bind(identity.user.id)
    .run();
  for (const endpoint of ['dictionary', 'review', 'knowledge'])
    assert.equal(
      (
        await mf.dispatchFetch('https://example.com/api/' + endpoint, {
          headers: { Cookie: cookie },
        })
      ).status,
      403,
    );
  const exported = await mf.dispatchFetch('https://example.com/api/account/export', {
    headers: { Cookie: cookie },
  });
  assert.equal(exported.status, 200);
  const personal = await exported.json();
  assert.equal(personal.vocabulary.length, 1);
  assert.equal(personal.review.cards.length, 1);
  assert.equal(personal.wordStates.length, 1);
  const freePrefs = await mf.dispatchFetch('https://example.com/api/sync/push', {
    method: 'POST',
    headers: reviewHeaders,
    body: JSON.stringify({
      ...sync,
      preferences: { ...sync.preferences, reviewLimits: undefined },
    }),
  });
  assert.equal(freePrefs.status, 200);
  const freeProgress = await mf.dispatchFetch('https://example.com/api/sync/bootstrap', {
    headers: { Cookie: cookie },
  });
  assert.equal(freeProgress.status, 200);
  const freeData = await freeProgress.json();
  assert.deepEqual(freeData.data.sessions, []);
  assert.equal(freeData.data.preferences.reviewLimits, undefined);
  assert.equal(
    (
      await mf.dispatchFetch('https://example.com/api/sync/push', {
        method: 'POST',
        headers: reviewHeaders,
        body: JSON.stringify(sync),
      })
    ).status,
    403,
  );
  await db
    .prepare("UPDATE user_access SET plan='pro' WHERE user_id=?")
    .bind(identity.user.id)
    .run();
  assert.equal(
    (await mf.dispatchFetch('https://example.com/api/dictionary', { headers: { Cookie: cookie } }))
      .status,
    200,
  );

  const dictionaryDeleted = await mf.dispatchFetch('https://example.com/api/dictionary', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: 'https://example.com', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delete', id: dictionaryPayload.entry.id }),
  });
  assert.equal(dictionaryDeleted.status, 200);
  assert.equal(
    (
      await (
        await mf.dispatchFetch('https://example.com/api/review', { headers: { Cookie: cookie } })
      ).json()
    ).cards.length,
    0,
  );
  assert.equal(
    (
      await db
        .prepare('SELECT COUNT(*) AS n FROM user_dictionary_entries WHERE user_id=?')
        .bind(identity.user.id)
        .first()
    ).n,
    0,
  );
  await db
    .prepare("UPDATE user_access SET plan='free' WHERE user_id=?")
    .bind(identity.user.id)
    .run();
  let lesson;
  for (let i = 0; i < 2; i++) {
    const response = await mf.dispatchFetch('https://example.com/api/prepare', {
      method: 'POST',
      headers: i === 1 ? { Cookie: cookie } : {},
      body: JSON.stringify({ url: 'https://youtu.be/IJ6R4u05ppw' }),
    });
    const last = JSON.parse((await response.text()).trim().split('\n').at(-1));
    assert.equal(last.stage, 'done');
    lesson = last.lesson;
  }
  assert.equal(captions, 1);
  await db
    .prepare("UPDATE user_access SET plan='pro' WHERE user_id=?")
    .bind(identity.user.id)
    .run();
  for (const endpoint of ['quiz', 'difficulty']) {
    let first;
    for (let i = 0; i < 2; i++) {
      const response = await mf.dispatchFetch(`https://example.com/api/${endpoint}`, {
        method: 'POST',
        headers: { Cookie: cookie },
        body: JSON.stringify({ lesson, content: { contentKey: lesson.mediaSource.contentKey } }),
      });
      assert.equal(response.status, 200, `${endpoint} failed: ${await response.clone().text()}`);
      assert.equal(response.headers.get('X-Hibiki-Cache'), i ? 'hit' : 'miss');
      const payload = await response.json();
      if (i) assert.deepEqual(payload, first);
      else first = payload;
    }
  }
  const ai = await mf.getWorker('ai-mock');
  assert.deepEqual(await (await ai.fetch('https://example.com/counts')).json(), {
    quiz: 1,
    difficulty: 1,
    transcription: 6,
  });
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM linked_transcripts').first()).n, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM generated_artifacts').first()).n, 2);

  // The new feed is metadata-only; saving a card cannot acquire captions or run AI.
  const catalogueTime = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO discovery_videos(video_id,canonical_url,title,channel_id,channel_title,duration_seconds,
    published_at,caption_flag,embeddable,status,fetched_at,expires_at,indexed_at,topic_keys_json)
    VALUES(?,?,?,?,?,540,?,1,1,'available',?,?,?,'["everyday"]')`,
    )
    .bind(
      lesson.videoId,
      `https://www.youtube.com/watch?v=${lesson.videoId}`,
      'Discover runtime fixture',
      'creator',
      'Runtime creator',
      catalogueTime,
      catalogueTime,
      new Date(Date.now() + 86400000).toISOString(),
      catalogueTime,
    )
    .run();
  const feed = await mf.dispatchFetch('https://example.com/api/discover');
  assert.equal(feed.status, 200);
  const feedData = await feed.json();
  assert.equal(feedData.items.length, 1);
  assert.equal(feedData.items[0].band, null);
  assert.ok(!('segments' in feedData.items[0]));
  await db
    .prepare("UPDATE user_access SET plan='free' WHERE user_id=?")
    .bind(identity.user.id)
    .run();
  const watchHeaders = {
    Cookie: cookie,
    Origin: 'https://example.com',
    'Content-Type': 'application/json',
    'X-Hibiki-Account': identity.user.id,
  };
  for (let repeat = 0; repeat < 2; repeat++)
    assert.equal(
      (
        await mf.dispatchFetch('https://example.com/api/watch-later', {
          method: 'POST',
          headers: watchHeaders,
          body: JSON.stringify({ videoId: lesson.videoId, title: 'Discover runtime fixture' }),
        })
      ).status,
      200,
    );
  const savedQueue = await mf.dispatchFetch('https://example.com/api/watch-later', {
    headers: watchHeaders,
  });
  assert.equal(savedQueue.headers.get('Cache-Control'), 'no-store');
  assert.equal((await savedQueue.json()).records.length, 1);
  assert.equal(
    (
      await mf.dispatchFetch('https://example.com/api/discover/preferences', {
        method: 'PATCH',
        headers: watchHeaders,
        body: JSON.stringify({
          preferredBand: 'n4_n3',
          topics: ['travel'],
          duration: '5to10',
          diversity: 'wide',
        }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await mf.dispatchFetch('https://example.com/api/watch-later', {
        headers: { ...watchHeaders, 'X-Hibiki-Account': 'another-user' },
      })
    ).status,
    409,
  );
  assert.equal(captions, 1);
  assert.deepEqual(await (await ai.fetch('https://example.com/counts')).json(), {
    quiz: 1,
    difficulty: 1,
    transcription: 6,
  });

  const completedAt = new Date(Date.now() - 5 * 86400000).toISOString();
  await db
    .prepare(
      'INSERT INTO user_practice_sessions(user_id,id,lesson_id,transcript_key,payload_json,updated_at) VALUES(?,?,?,?,?,?)',
    )
    .bind(
      identity.user.id,
      'runtime-completion-day',
      lesson.id,
      'runtime-fixture-key',
      JSON.stringify({ completed: true, completedAt }),
      completedAt,
    )
    .run();
  assert.equal(
    (
      await mf.dispatchFetch('https://example.com/api/discover/events', {
        method: 'POST',
        headers: watchHeaders,
        body: JSON.stringify({ events: [{ videoId: lesson.videoId, action: 'complete' }] }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT day FROM discovery_metric_events WHERE user_id=? AND video_id=? AND action='complete'",
        )
        .bind(identity.user.id, lesson.videoId)
        .first()
    )?.day,
    completedAt.slice(0, 10),
  );

  // Exercise rollback through the public request adapter, retaining the configured HTTPS origin.
  await mf.setOptions({
    ...options,
    workers: options.workers.map((worker, index) =>
      index !== 0
        ? worker
        : {
            ...worker,
            config: {
              ...worker.config,
              env: { ...worker.config.env, DISCOVER_ENABLED: { type: 'text', value: 'false' } },
            },
          },
    ),
  });
  assert.equal((await mf.dispatchFetch('https://example.com/api/discover')).status, 404);
  assert.equal((await mf.dispatchFetch('https://example.com/discover')).status, 404);
  const disabledWatch = await mf.dispatchFetch('https://example.com/api/watch-later', {
    headers: watchHeaders,
  });
  assert.equal(
    disabledWatch.status,
    200,
    disabledWatch.status !== 200 ? await disabledWatch.text() : undefined,
  );

  const signedOut = await mf.dispatchFetch('https://example.com/api/auth/sign-out', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: 'https://example.com', 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(signedOut.status, 200);
  assert.equal(
    (
      await mf.dispatchFetch('https://example.com/api/sync/bootstrap', {
        headers: { Cookie: cookie },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await mf.dispatchFetch('https://example.com/api/dictionary', {
        headers: { Cookie: cookie },
      })
    ).status,
    401,
  );
  console.log(
    'Built Worker + D1: accounts, Discover metadata feed, idempotent Watch Later, preferences, ownership, unchanged caption/AI counts, existing cache and sign-out passed.',
  );
} finally {
  await mf.dispose();
}
