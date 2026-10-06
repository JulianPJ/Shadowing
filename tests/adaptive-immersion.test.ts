import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { localProgressDatabase } from '../src/lib/sync/local-database';
import { D1KnowledgeRepository } from '../src/lib/knowledge/repository';
import { handleKnowledgeRequest } from '../src/lib/knowledge/server';
import { mergeKnowledge, validateKnowledgeRecord } from '../src/lib/knowledge/validation';
import { analyzeVocabulary } from '../src/lib/knowledge/analysis';
import { lookupCandidates, matchLexicalEntries } from '../src/lib/lexicon/lookup';
import type { MorphologicalToken } from '../src/lib/japanese-readings';
import type { LexiconEntry } from '../src/lib/lexicon/types';
import type { WordKnowledgeRecord } from '../src/lib/knowledge/types';
import { installMemoryStorage } from './helpers/memory-storage';
import { markWords, loadKnowledge, knowledgePending } from '../src/lib/knowledge/client';
import { setStorageAccount } from '../src/lib/storage/browser';

const at = '2026-10-05T10:00:00.000Z';
const record = (
  lemma: string,
  state: WordKnowledgeRecord['state'],
  updatedAt = at,
): WordKnowledgeRecord => ({ lemma, state, reading: null, updatedAt });
const token = (
  surface_form: string,
  basic_form = surface_form,
  pos = '名詞',
): MorphologicalToken => ({ surface_form, basic_form, pos, word_type: 'KNOWN' });

test('word state conflicts converge, Unknown resets persist, and invalid records are rejected', () => {
  const known = record('食べる', 'known'),
    learning = record('食べる', 'learning');
  assert.deepEqual(mergeKnowledge([known], [learning]), mergeKnowledge([learning], [known]));
  const reset = record('食べる', 'unknown', '2026-10-06T10:00:00.000Z');
  assert.equal(mergeKnowledge([reset], [known])['食べる'].state, 'unknown');
  assert.throws(() => validateKnowledgeRecord({ ...known, state: 'mastered' }));
  assert.throws(() => validateKnowledgeRecord({ ...known, lemma: ' 食べる ' }));
  assert.throws(() => validateKnowledgeRecord({ ...known, lemma: 'script' }));
  assert.throws(() => validateKnowledgeRecord({ ...known, updatedAt: 'not-a-date' }));
});

test('native SQL word knowledge uses account ownership, pagination, stale-write protection and cascade', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(
      "PRAGMA foreign_keys=ON; CREATE TABLE user (id TEXT PRIMARY KEY); INSERT INTO user VALUES ('a'),('b');",
    );
    db.exec(readFileSync('migrations/0009_word_knowledge.sql', 'utf8'));
    const repository = new D1KnowledgeRepository(localProgressDatabase(db));
    const records = Array.from({ length: 280 }, (_, index) =>
      record(`日本語${String(index).padStart(3, '0')}`, 'known'),
    );
    await repository.apply('a', records);
    await repository.apply('b', [record('食べる', 'ignored')]);
    const page = await repository.page('a');
    assert.equal(page.records.length, 250);
    assert.ok(page.nextCursor);
    const next = await repository.page('a', page.nextCursor);
    assert.equal(next.records.length, 30);
    assert.equal(next.nextCursor, null);
    assert.equal(new Set([...page.records, ...next.records].map((value) => value.lemma)).size, 280);
    assert.equal((await repository.page('b')).records[0].state, 'ignored');
    await repository.apply('a', [record(records[0].lemma, 'unknown', '2026-10-04T10:00:00.000Z')]);
    assert.equal((await repository.page('a')).records[0].state, 'known');
    await repository.apply('a', [record(records[0].lemma, 'unknown', '2026-10-06T10:00:00.000Z')]);
    assert.equal((await repository.page('a')).records[0].state, 'unknown');
    db.prepare('DELETE FROM user WHERE id=?').run('a');
    assert.equal((await repository.page('a')).records.length, 0);
    assert.equal((await repository.page('b')).records.length, 1);
  } finally {
    db.close();
  }
});

test('knowledge endpoint bounds batches and rejects unverified mutation, invalid states and future conflicts', async () => {
  const applied: WordKnowledgeRecord[][] = [];
  const repository = {
    async page() {
      return { records: [], nextCursor: null };
    },
    async apply(_owner: string, records: WordKnowledgeRecord[]) {
      applied.push(records);
    },
  };
  const request = (records: unknown) =>
    new Request('https://hibiki.example/api/knowledge', {
      method: 'POST',
      body: JSON.stringify({ records }),
    });
  assert.equal(
    (await handleKnowledgeRequest(request([record('朝', 'known')]), 'a', false, repository)).status,
    403,
  );
  assert.equal(
    (await handleKnowledgeRequest(request([record('朝', 'known')]), 'a', true, repository)).status,
    200,
  );
  assert.equal(applied.length, 1);
  assert.equal(
    (
      await handleKnowledgeRequest(
        request(Array.from({ length: 101 }, () => record('朝', 'known'))),
        'a',
        true,
        repository,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handleKnowledgeRequest(
        request([{ ...record('朝', 'known'), state: 'wrong' }]),
        'a',
        true,
        repository,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handleKnowledgeRequest(
        request([record('朝', 'known', '2099-01-01T00:00:00.000Z')]),
        'a',
        true,
        repository,
      )
    ).status,
    400,
  );
  assert.equal(applied.length, 1);
});

test('coverage counts explicit lexical knowledge, excludes function words and withholds incomplete percentages', () => {
  const segments = [
    { id: 'a', start: 0, end: 4, japanese: '猫を食べます。' },
    { id: 'b', start: 5, end: 9, japanese: '猫が寝る。' },
  ];
  const tokens = {
    a: [
      token('猫'),
      token('を', 'を', '助詞'),
      token('食べ', '食べる', '動詞'),
      token('ます', 'ます', '助動詞'),
      token('。', '。', '記号'),
    ],
    b: [
      token('猫'),
      token('が', 'が', '助詞'),
      token('寝る', '寝る', '動詞'),
      token('。', '。', '記号'),
    ],
  };
  const result = analyzeVocabulary(
    segments,
    tokens,
    mergeKnowledge([record('食べる', 'known'), record('寝る', 'known')]),
  );
  assert.equal(result.knownPercent, 50);
  assert.equal(result.totalTokens, 4);
  assert.equal(result.uniqueLemmas, 3);
  assert.equal(result.sections[0].oneUnknown, true);
  assert.equal(result.sections[1].highValue, true);
  assert.match(result.sections[0].reason, /猫/);
  const ignored = analyzeVocabulary(
    segments,
    tokens,
    mergeKnowledge([record('食べる', 'known'), record('寝る', 'known'), record('猫', 'ignored')]),
  );
  assert.equal(ignored.knownPercent, 100);
  assert.equal(ignored.ignoredTokens, 2);
  assert.equal(ignored.sections[0].oneUnknown, false);
  const bad = analyzeVocabulary(segments, { ...tokens, b: [token('猫')] }, {});
  assert.equal(bad.complete, false);
  assert.equal(bad.analyzedSegments, 1);
  assert.equal(bad.knownPercent, null);
  assert.equal(
    analyzeVocabulary(
      [{ ...segments[0], estimated: true }],
      tokens,
      mergeKnowledge([record('食べる', 'known')]),
    ).sections[0].oneUnknown,
    false,
  );
});

test('local-first word states persist across account namespaces without inferring imports', () => {
  installMemoryStorage();
  setStorageAccount(null);
  markWords([{ lemma: '朝', reading: 'あさ' }], 'learning');
  assert.equal(loadKnowledge()['朝'].state, 'learning');
  assert.equal(knowledgePending(), 0);
  setStorageAccount('learner-a');
  assert.deepEqual(loadKnowledge(), {});
  markWords([{ lemma: '朝' }], 'known');
  assert.equal(knowledgePending(), 1);
  setStorageAccount('learner-b');
  assert.deepEqual(loadKnowledge(), {});
  markWords([{ lemma: '夜' }], 'ignored');
  setStorageAccount('learner-a');
  assert.equal(loadKnowledge()['朝'].state, 'known');
  assert.equal(loadKnowledge()['夜'], undefined);
  setStorageAccount(null);
  assert.equal(loadKnowledge()['朝'].state, 'learning');
});

test('morphology deinflects verb/auxiliary chains without collapsing arbitrary noun phrases', () => {
  assert.deepEqual(
    lookupCandidates('食べました', [
      token('食べ', '食べる', '動詞'),
      token('まし', 'ます', '助動詞'),
      token('た', 'た', '助動詞'),
    ]),
    ['食べました', '食べる'],
  );
  assert.deepEqual(lookupCandidates('猫食事', [token('猫'), token('食事')]), ['猫食事']);
});

test('dictionary lookup preserves reading-specific senses and orthographic restrictions', () => {
  const sense = {
    partOfSpeech: ['n'],
    appliesToKanji: ['*'],
    appliesToKana: ['*'],
    field: [],
    dialect: [],
    misc: [],
    info: [],
    gloss: ['test'],
  };
  const entry: LexiconEntry = {
    id: '123',
    kanji: [
      { text: '生', common: true, tags: [] },
      { text: '別', common: false, tags: [] },
    ],
    kana: [
      { text: 'なま', common: true, tags: [], appliesToKanji: ['生'] },
      { text: 'せい', common: false, tags: [], appliesToKanji: ['生'] },
    ],
    sense: [
      { ...sense, appliesToKana: ['なま'], gloss: ['raw'] },
      { ...sense, appliesToKana: ['せい'], gloss: ['life'] },
      { ...sense, appliesToKanji: ['別'], gloss: ['other spelling only'] },
    ],
  };
  const matches = matchLexicalEntries([entry], '生', '生', 'せい');
  assert.equal(matches.length, 2);
  assert.equal(matches[0].reading, 'せい');
  assert.deepEqual(
    matches[0].senses.map((value) => value.gloss),
    [['life']],
  );
  assert.deepEqual(
    matches[1].senses.map((value) => value.gloss),
    [['raw']],
  );
});
