import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { D1Database } from '../src/lib/d1';
import {
  createD1LinkedTranscriptRepository,
  storedMediaIdentity,
  transcriptHash,
  type StoredTranscript,
} from '../src/lib/linked-transcripts';
import {
  createD1GeneratedArtifactRepository,
  QUIZ_GENERATOR_VERSION,
  DIFFICULTY_GENERATOR_VERSION,
} from '../src/lib/generated-artifacts';
import { resolveMediaUrl } from '../src/lib/media';
import { createPrepareHandler } from '../src/lib/prepare';
import { segmentTranscript } from '../src/lib/segmentation';
import { createQuiz, transcriptKey, validateQuizLesson } from '../src/lib/quiz';
import { createDifficultyAnalysis } from '../src/lib/difficulty';
import { handleQuizRequest } from '../src/lib/quiz-api';
import { handleDifficultyRequest } from '../src/lib/difficulty-api';
import { contentRequest } from '../src/lib/content-request';
import { handleDiscoveryRequest } from '../src/lib/discovery-api';
import type { ArtifactType } from '../src/lib/generated-artifacts';
import type { Cue, Lesson, QuizLesson } from '../src/lib/types';
import type { SharedContentDependencies } from '../src/lib/shared-content';

const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: '2026-10-03',
    d1Databases: { HIBIKI_DB: 'local-test' },
  }),
);
let db: D1Database;
let storage: SharedContentDependencies;
const contentKey = 'youtube:IJ6R4u05ppw';
const cues: Cue[] = Array.from({ length: 6 }, (_, i) => ({
  start: i * 8,
  end: i * 8 + 7,
  text: `今日は日本語の勉強について詳しく話します。毎日練習すると少しずつ上手になります。${i}。`,
}));
let record: StoredTranscript;
let lesson: QuizLesson;
const semantic = {
  overall: 'n4_n3',
  vocabulary: 'intermediate',
  grammar: 'elementary',
  conversation: 'intermediate',
  confidence: { overall: 0.5, vocabulary: 0.5, grammar: 0.5, conversation: 0.5 },
};
function questions(input: QuizLesson) {
  return {
    questions: Array.from({ length: 3 }, (_, i) => ({
      kind: 'detail',
      question: `何について話しますか${i}？`,
      options: ['日本語', '英語', '数学', '料理'],
      correctIndex: 0,
      explanation: 'The speaker discusses Japanese practice.',
      evidence: { segmentIds: [input.segments[i].id] },
    })),
  };
}
before(async () => {
  db = await mf.getD1Database('HIBIKI_DB');
  const sql = await readFile('migrations/0001_shared_content.sql', 'utf8');
  await db.batch(
    sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db.prepare(s)),
  );
  storage = {
    transcripts: createD1LinkedTranscriptRepository(db),
    artifacts: createD1GeneratedArtifactRepository(db),
  };
  const media = (await resolveMediaUrl('https://youtu.be/IJ6R4u05ppw')).media;
  const hash = await transcriptHash(cues);
  record = {
    schemaVersion: 1,
    contentKey,
    media: storedMediaIdentity(media),
    language: 'ja',
    cues,
    transcriptHash: hash,
    source: {
      schemaVersion: 1,
      type: 'provider-captions',
      language: 'ja',
      provenance: 'test-captions',
      provider: 'test-captions',
      transcriptHash: hash,
      normalizationVersion: 1,
      segmentationVersion: 1,
    },
    createdAt: new Date().toISOString(),
    visibility: 'system',
  };
  lesson = validateQuizLesson({
    id: 'youtube-IJ6R4u05ppw',
    videoId: 'IJ6R4u05ppw',
    segments: segmentTranscript(cues),
  });
});
after(() => mf.dispose());
beforeEach(async () => {
  await db.batch([
    db.prepare('DELETE FROM linked_transcripts'),
    db.prepare('DELETE FROM generated_artifacts'),
  ]);
});
const request = (input = lesson, key: string | null = contentKey) =>
  new Request('https://example.com/api', {
    method: 'POST',
    body: JSON.stringify({ lesson: input, ...(key ? { content: { contentKey: key } } : {}) }),
  });

test('public discovery validates captions and matching difficulty, excludes private and corrupted content', async () => {
  await storage.transcripts!.save(record);
  const difficulty = await createDifficultyAnalysis(semantic, lesson);
  await storage.artifacts!.save(
    {
      contentKey,
      transcriptKey: await transcriptKey(lesson),
      sourceTranscriptHash: record.transcriptHash,
      artifactType: 'difficulty',
      schemaVersion: 1,
      generatorVersion: DIFFICULTY_GENERATOR_VERSION,
      payload: difficulty,
      payloadId: difficulty.id,
      createdAt: difficulty.generatedAt,
    },
    lesson,
  );
  const metadata = async () =>
    Response.json({ title: 'Real public lesson', author_name: 'Japanese teacher' });
  const response = await handleDiscoveryRequest(
    new Request('https://example.com/api/discovery'),
    db,
    metadata,
  );
  const snapshot = await response.json();
  assert.equal(snapshot.lessons.length, 1);
  assert.equal(snapshot.lessons[0].title, 'Real public lesson');
  assert.deepEqual(
    snapshot.lessons[0].segments,
    JSON.parse(JSON.stringify(segmentTranscript(cues))),
  );
  assert.equal(snapshot.difficulties.length, 1);
  const unavailableMetadata = await handleDiscoveryRequest(
    new Request('https://example.com/api/discovery'),
    db,
    async () => new Response(null, { status: 404 }),
  );
  assert.deepEqual(await unavailableMetadata.json(), { lessons: [], difficulties: [] });
  await db
    .prepare("UPDATE linked_transcripts SET visibility='private', owner_user_id='someone'")
    .run();
  const privateResult = await handleDiscoveryRequest(
    new Request('https://example.com/api/discovery'),
    db,
    metadata,
  );
  assert.deepEqual((await privateResult.json()).lessons, []);
  await db
    .prepare(
      "UPDATE linked_transcripts SET visibility='system', owner_user_id=NULL, cues_json='[]'",
    )
    .run();
  const invalidResult = await handleDiscoveryRequest(
    new Request('https://example.com/api/discovery'),
    db,
    metadata,
  );
  assert.deepEqual((await invalidResult.json()).lessons, []);
});

test('public discovery is optional, GET-only and does not require learner authentication', async () => {
  const request = new Request('https://example.com/api/discovery');
  assert.deepEqual(await (await handleDiscoveryRequest(request)).json(), {
    lessons: [],
    difficulties: [],
  });
  assert.equal(
    (await handleDiscoveryRequest(new Request(request, { method: 'POST' }))).status,
    405,
  );
});

test('D1 transcript miss/provider/save/hit bypasses captions on second prepare', async () => {
  let calls = 0;
  const handler = createPrepareHandler({
    repository: storage.transcripts,
    fetchImpl: async () => Response.json({}),
    captions: {
      name: 'test-captions',
      async transcribe() {
        calls++;
        return { cues };
      },
    },
  });
  for (let i = 0; i < 2; i++) {
    const response = await handler(
      new Request('https://example.com/api/prepare', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://youtu.be/IJ6R4u05ppw' }),
      }),
    );
    assert.equal(JSON.parse((await response.text()).trim().split('\n').at(-1)!).stage, 'done');
  }
  assert.equal(calls, 1);
});
test('D1 rejects corrupt JSON/hash, versions and private visibility', async () => {
  for (const [column, value] of [
    ['cues_json', '{'],
    ['transcript_hash', 'bad'],
    ['normalization_version', 2],
    ['visibility', 'private'],
    ['source_type', 'user-upload'],
  ] as const) {
    await db.prepare('DELETE FROM linked_transcripts').run();
    await storage.transcripts.save(record);
    await db.prepare(`UPDATE linked_transcripts SET ${column}=?`).bind(value).run();
    assert.equal(await storage.transcripts.lookup({ contentKey, language: 'ja' }), null);
  }
});
test('anonymous transcript writes reject user imports, owners and private records', async () => {
  for (const modified of [
    { visibility: 'private' },
    { ownerId: 'user' },
    { source: { ...record.source, type: 'user-upload' } },
    { source: { ...record.source, type: 'user-paste' } },
  ]) {
    await assert.rejects(storage.transcripts.save({ ...record, ...modified } as StoredTranscript));
  }
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS n FROM linked_transcripts').first<{ n: number }>())!.n,
    0,
  );
});
test('direct and Vimeo playback secrets never enter stored identity or database', async () => {
  for (const url of ['https://example.com/a.mp4?token=SECRET', 'https://vimeo.com/123456/SECRET']) {
    const media = (await resolveMediaUrl(url)).media;
    const safe = storedMediaIdentity(media);
    assert.equal(JSON.stringify(safe).includes('SECRET'), false);
    await storage.transcripts.save({ ...record, contentKey: media.contentKey, media: safe });
  }
  const rows = await db.prepare('SELECT * FROM linked_transcripts').all();
  assert.equal(JSON.stringify(rows.results).includes('SECRET'), false);
  await assert.rejects(
    storage.transcripts.save({
      ...record,
      media: { ...record.media, canonicalUrl: 'https://example.com/?secret=x' },
    } as StoredTranscript),
  );
});
test('duplicate logical transcript saves are idempotent and lookup is indexed', async () => {
  await Promise.all([storage.transcripts.save(record), storage.transcripts.save(record)]);
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS n FROM linked_transcripts').first<{ n: number }>())!.n,
    1,
  );
  const plan = await db
    .prepare(
      'EXPLAIN QUERY PLAN SELECT * FROM linked_transcripts WHERE content_key=? AND language=? ORDER BY created_at DESC,storage_key DESC LIMIT 1',
    )
    .bind(contentKey, 'ja')
    .all();
  assert.match(JSON.stringify(plan.results), /linked_transcripts_lookup/);
});
test('prepare lookup/save failures and corrupt repository data still allow captions', async () => {
  for (const repository of [
    {
      async lookup() {
        throw new Error('outage');
      },
      async save() {
        throw new Error('outage');
      },
    },
    {
      async lookup() {
        return { ...record, transcriptHash: 'bad' };
      },
      async save() {
        throw new Error('outage');
      },
    },
  ]) {
    const handler = createPrepareHandler({
      repository,
      fetchImpl: async () => Response.json({}),
      captions: {
        name: 'test-captions',
        async transcribe() {
          return { cues };
        },
      },
    });
    const response = await handler(
      new Request('https://example.com/api/prepare', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://youtu.be/IJ6R4u05ppw' }),
      }),
    );
    assert.equal(JSON.parse((await response.text()).trim().split('\n').at(-1)!).stage, 'done');
  }
});
for (const type of ['quiz', 'difficulty'] as ArtifactType[]) {
  const handle = (req: Request, deps = storage, fail = false, called = () => {}) =>
    type === 'quiz'
      ? handleQuizRequest(
          req,
          {
            name: 'mock',
            async generate(input) {
              called();
              if (fail) throw new Error('Provider must be bypassed');
              return questions(input);
            },
          },
          deps,
        )
      : handleDifficultyRequest(
          req,
          {
            name: 'mock',
            async analyze() {
              called();
              if (fail) throw new Error('Provider must be bypassed');
              return semantic;
            },
          },
          deps,
        );
  test(`${type}: miss calls provider once, saves validated payload; hit bypasses throwing provider`, async () => {
    await storage.transcripts.save(record);
    let calls = 0;
    const first = await handle(request(), storage, false, () => calls++);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('X-Hibiki-Cache'), 'miss');
    const second = await handle(request(), storage, true);
    assert.equal(second.status, 200);
    assert.equal(second.headers.get('X-Hibiki-Cache'), 'hit');
    assert.equal(calls, 1);
    assert.deepEqual(await second.json(), await first.json());
  });
  test(`${type}: generator/transcript version mismatch and corrupt domain payload miss`, async () => {
    await storage.transcripts.save(record);
    for (const [column, value] of [
      ['generator_version', 'old-version'],
      ['transcript_key', 'b'.repeat(64)],
      ['payload_json', '{'],
      ['payload_json', '{}'],
    ] as const) {
      await handle(request());
      await db.prepare(`UPDATE generated_artifacts SET ${column}=?`).bind(value).run();
      let calls = 0;
      const response = await handle(request(), storage, false, () => calls++);
      assert.equal(response.status, 200);
      assert.equal(calls, 1);
      assert.equal(response.headers.get('X-Hibiki-Cache'), 'miss');
      await db.prepare('DELETE FROM generated_artifacts').run();
    }
  });
  test(`${type}: forged contentKey, edited transcript, local/private requests bypass shared storage`, async () => {
    await storage.transcripts.save(record);
    const forged = {
      ...lesson,
      segments: lesson.segments.map((s) => ({ ...s, japanese: '別の話です。'.repeat(15) })),
    };
    for (const req of [
      request(forged),
      request(lesson, 'youtube:KJblreFQ2R8'),
      request(lesson, null),
      new Request('https://example.com/api', { method: 'POST', body: JSON.stringify(lesson) }),
    ]) {
      const response = await handle(req);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('X-Hibiki-Cache'), 'bypass');
    }
    assert.equal(
      (await db.prepare('SELECT COUNT(*) AS n FROM generated_artifacts').first<{ n: number }>())!.n,
      0,
    );
    const media = (await resolveMediaUrl('https://youtu.be/IJ6R4u05ppw')).media;
    for (const source of ['user-upload', 'user-paste'] as const) {
      const input = {
        ...lesson,
        mediaSource: media,
        transcript: { ...record.source, type: source },
      } as Lesson;
      assert.equal('content' in contentRequest(input, lesson), false);
    }
    assert.equal(
      'content' in
        contentRequest(
          {
            ...lesson,
            mediaSource: { schemaVersion: 1, type: 'local', fileName: 'local.mp4' },
          } as Lesson,
          lesson,
        ),
      false,
    );
  });
  test(`${type}: lookup/save outages preserve successful inference`, async () => {
    await storage.transcripts.save(record);
    for (const deps of [
      {
        ...storage,
        artifacts: {
          async lookup() {
            throw new Error('outage');
          },
          async save() {
            throw new Error('outage');
          },
        },
      },
      {
        ...storage,
        transcripts: {
          async lookup() {
            throw new Error('outage');
          },
          async save() {},
        },
      },
    ])
      assert.equal((await handle(request(), deps)).status, 200);
  });
  test(`${type}: unique logical artifact saves, schema/index identity and rebinding lesson IDs`, async () => {
    await storage.transcripts.save(record);
    await handle(request());
    const renamed = { ...lesson, id: 'another-local-id' };
    const response = await handle(request(renamed), storage, true);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal((body.quiz ?? body.analysis).lessonId, renamed.id);
    const key = await transcriptKey(lesson);
    const lookup = {
      contentKey,
      transcriptKey: key,
      artifactType: type,
      schemaVersion: 1,
      generatorVersion: type === 'quiz' ? QUIZ_GENERATOR_VERSION : DIFFICULTY_GENERATOR_VERSION,
    };
    const stored = (await storage.artifacts.lookup(lookup))!;
    const canonical = { ...lesson, videoId: undefined };
    await Promise.all([
      storage.artifacts.save(stored, canonical),
      storage.artifacts.save(stored, canonical),
    ]);
    assert.equal(
      (await db.prepare('SELECT COUNT(*) AS n FROM generated_artifacts').first<{ n: number }>())!.n,
      1,
    );
    const plan = await db
      .prepare(
        'EXPLAIN QUERY PLAN SELECT * FROM generated_artifacts WHERE content_key=? AND transcript_key=? AND artifact_type=? AND schema_version=? AND generator_version=?',
      )
      .bind(contentKey, key, type, 1, lookup.generatorVersion)
      .all();
    assert.match(JSON.stringify(plan.results), /USING INDEX/);
  });
}
test('repository rejects unvalidated quiz/difficulty writes', async () => {
  const identity = {
    contentKey,
    transcriptKey: await transcriptKey(lesson),
    artifactType: 'quiz' as const,
    schemaVersion: 1,
    generatorVersion: QUIZ_GENERATOR_VERSION,
    sourceTranscriptHash: record.transcriptHash,
    payloadId: 'bad',
    payload: {},
    createdAt: record.createdAt,
  };
  await assert.rejects(storage.artifacts.save(identity, lesson));
  const quiz = await createQuiz(questions(lesson), lesson);
  const difficulty = await createDifficultyAnalysis(semantic, lesson);
  assert.ok(quiz.questions.length);
  assert.equal(difficulty.coverage.strategyVersion, 2);
});
