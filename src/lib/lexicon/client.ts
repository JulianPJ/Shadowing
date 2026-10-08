'use client';
import source from '../../../scripts/lexicon-source.json';
import { japaneseMorphology } from '../furigana-client';
import { hiragana } from '../japanese-readings';
import { lexiconShard } from './shard';
import { lookupCandidates, matchLexicalEntries, canonicalLemma } from './lookup';
import type { LexiconEntry, LexiconResult } from './types';
import { selectedMorphology } from '../japanese-lexical-spans';

const path = '/lexicon/' + source.version;
const shards = new Map<string, Promise<Record<string, unknown>>>();
let manifest: Promise<{ tags: Record<string, string>; dictionaryDate: string }> | undefined;
async function jsonAsset(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok)
    throw new Error(
      'The local Japanese dictionary is unavailable. You can still mark this word and enter a meaning.',
    );
  return response.json();
}
function loadShard(kind: string, key: string) {
  const name = `${kind}-${lexiconShard(key)}`;
  const existing = shards.get(name);
  if (existing) return existing;
  const value = jsonAsset(`${path}/${name}.json`) as Promise<Record<string, unknown>>;
  shards.set(name, value);
  if (shards.size > 24) shards.delete(shards.keys().next().value!);
  void value.catch(() => {
    if (shards.get(name) === value) shards.delete(name);
  });
  return value;
}
export async function lookupJapanese(
  selected: string,
  sentence = selected,
): Promise<LexiconResult> {
  const term = selected.trim();
  if (!term || term.length > 120) throw new Error('Select a word or short phrase.');
  const tokens = await japaneseMorphology(sentence).catch(() => []);
  const candidates = lookupCandidates(term, tokens);
  if (candidates.length === 1 && term !== sentence) {
    // Phrase selection may not match the sentence's morphological token boundaries.
    try {
      candidates.push(
        ...lookupCandidates(term, await japaneseMorphology(term)).filter(
          (value) => !candidates.includes(value),
        ),
      );
    } catch {
      /* Exact dictionary lookup remains useful. */
    }
  }
  const contextual = selectedMorphology(term, tokens)[0];
  // A phrase can start with a noun without being that noun's inflected form.
  // Only prefer a contextual lemma when candidate generation validated the form.
  const token =
    contextual && candidates.includes(canonicalLemma(contextual)) ? contextual : undefined;
  const preferredReading = token?.reading ? hiragana(token.reading) : undefined;
  let matches: LexiconResult['matches'] = [];
  for (const candidate of candidates) {
    const index = await loadShard('index', candidate);
    const ids = (index[candidate] ?? []) as string[];
    const entries = await Promise.all(
      ids.map(async (id) => (await loadShard('entries', id))[id] as LexiconEntry),
    );
    matches.push(...matchLexicalEntries(entries, candidate, term, preferredReading));
  }
  matches = [
    ...new Map(
      matches.map((match) => [match.entry.id + ':' + match.lemma + ':' + match.reading, match]),
    ).values(),
  ];
  // A contextual dictionary form takes precedence over an unrelated exact surface homograph.
  const lemma = token ? canonicalLemma(token) : (matches[0]?.lemma ?? term);
  matches.sort((a, b) => Number(b.lemma === lemma) - Number(a.lemma === lemma));
  const info = await (manifest ??= jsonAsset(path + '/manifest.json').catch((error) => {
    manifest = undefined;
    throw error;
  }));
  return { selected: term, lemma, matches, tags: info.tags, dictionaryDate: info.dictionaryDate };
}
