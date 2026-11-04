'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { VocabularyHeader } from './vocabulary-header';
import { ProFeatureNotice, useProAccess } from './pro-feature';
import { useAccount } from './account';
import { inspectPackage, importGroups, sendImport } from '@/lib/anki/client';
import { mappedRecords, suggestMapping } from '@/lib/anki/normalize';
import { roles, type AnkiPackage, type Mapping, type ImportResult } from '@/lib/anki/types';
import { refreshReview } from '@/lib/review/client';
import { knowledgeSync } from '@/lib/knowledge/client';

const labels = {
  term: 'Japanese word or expression',
  reading: 'Reading',
  translation: 'Meaning',
  sourceSentence: 'Example sentence',
  sourceSentenceTranslation: 'Sentence translation',
};
const emptyResult = (): ImportResult => ({
  imported: 0,
  duplicates: 0,
  ambiguous: 0,
  skipped: 0,
  known: 0,
  learning: 0,
  preserved: 0,
  rowsRead: 0,
  rowsWritten: 0,
});
function addResult(a: ImportResult, b: ImportResult) {
  const counts = emptyResult();
  for (const key of Object.keys(counts) as (keyof Omit<ImportResult, 'conflicts'>)[])
    counts[key] = (a[key] ?? 0) + (b[key] ?? 0);
  return { ...counts, conflicts: [...(a.conflicts ?? []), ...(b.conflicts ?? [])].slice(0, 20) };
}
const stages = [
  'Choose package',
  'Select decks',
  'Map fields',
  'Classify words',
  'Preview',
  'Import report',
];
export function AnkiImport() {
  const { isPro } = useProAccess('vocabulary');
  const account = useAccount();
  return (
    <main className="dictionary-screen vocabulary-workspace">
      <VocabularyHeader active="import" />
      {!isPro ? (
        <ProFeatureNotice feature="Anki vocabulary import" />
      ) : !account.user?.emailVerified ? (
        <p>Sign in with a verified account to import vocabulary.</p>
      ) : (
        <ImportFlow key={account.user.id} />
      )}
    </main>
  );
}
function ImportFlow() {
  const [pkg, setPkg] = useState<AnkiPackage>();
  const [step, setStep] = useState(0);
  const [decks, setDecks] = useState<string[]>([]);
  const [maps, setMaps] = useState<Record<string, Mapping>>({});
  const [mode, setMode] = useState<'known' | 'learning' | 'interval'>('learning');
  const [cutoff, setCutoff] = useState(21);
  const [distinct, setDistinct] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState<ImportResult>();
  const [report, setReport] = useState<ImportResult>();
  const [offset, setOffset] = useState(0);
  const cancel = useRef<() => void>(() => {});
  const stop = useRef(false);
  const flow = useRef<HTMLElement>(null);
  useEffect(() => {
    const heading = flow.current?.querySelector<HTMLElement>('.import-stage h3');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }, [step]);
  useEffect(
    () => () => {
      stop.current = true;
      cancel.current();
    },
    [],
  );
  const mapped = useMemo(
    () =>
      pkg && (mode !== 'interval' || (cutoff > 0 && Number.isFinite(cutoff)))
        ? mappedRecords(pkg, decks, maps, mode, cutoff)
        : null,
    [pkg, cutoff, decks, maps, mode],
  );
  const records = mapped?.records.slice(offset, offset + 500) ?? [];
  const counts = new Map<string, number>();
  for (const r of mapped?.records ?? []) counts.set(r.term, (counts.get(r.term) ?? 0) + 1);
  const packageAmbiguous = records.filter((r) => counts.get(r.term)! > 1);
  const models =
    pkg?.models.filter((m) =>
      pkg.notes.some((n) => n.model === m.id && n.cards.some((c) => decks.includes(c.deck))),
    ) ?? [];
  const invalid =
    !records.length ||
    records.some((r) => r.decks.length > 8) ||
    models.some((m) => maps[m.id]?.term < 0);
  async function choose(file: File) {
    setError('');
    setBusy(true);
    setPreview(undefined);
    setReport(undefined);
    setOffset(0);
    stop.current = false;
    try {
      if (!/\.apkg$/i.test(file.name)) throw new Error('Choose an Anki .apkg package.');
      const task = inspectPackage(file);
      cancel.current = task.cancel;
      const data = await task.promise;
      if (stop.current) return;
      setPkg(data);
      setMaps(Object.fromEntries(data.models.map((m) => [m.id, suggestMapping(m)])));
      setDecks(data.decks);
      setStep(1);
    } catch (e) {
      if (!stop.current) setError((e as Error).message);
    } finally {
      if (!stop.current) setBusy(false);
    }
  }
  async function run(commit: boolean) {
    setBusy(true);
    setError('');
    setProgress(0);
    stop.current = false;
    let result = {
      ...emptyResult(),
      ambiguous: distinct ? 0 : packageAmbiguous.length,
      skipped: distinct ? 0 : packageAmbiguous.length,
    };
    let confirmed = distinct ? 0 : packageAmbiguous.length;
    try {
      for (const group of importGroups(
        distinct ? records : records.filter((r) => counts.get(r.term) === 1),
      )) {
        if (stop.current) break;
        result = addResult(
          result,
          await sendImport(group, commit ? 'import' : 'preview', distinct),
        );
        setProgress((n) => n + group.length);
        confirmed += group.length;
      }
      if (stop.current) {
        setError('Paused. Retry this batch to continue safely.');
      } else if (commit) {
        setReport(result);
        setStep(5);
        await Promise.all([refreshReview({ force: true }), knowledgeSync.sync({ force: true })]);
        window.dispatchEvent(new Event('hibiki:dictionary-change'));
      } else setPreview(result);
    } catch (e) {
      setError(
        (e as Error).message +
          (commit
            ? ` ${result.imported} new and ${result.duplicates} existing contexts confirmed. ${records.length - confirmed} contexts remain unconfirmed. Completed batches are saved. Retry safely; existing records and schedules are preserved.`
            : ''),
      );
    } finally {
      setBusy(false);
    }
  }
  function next() {
    setError('');
    setPreview(undefined);
    setStep((s) => s + 1);
  }
  return (
    <section ref={flow} className="anki-import" aria-labelledby="anki-title">
      <h2 id="anki-title">Bring your Anki words into Hibiki</h2>
      <p>
        Keep your deck structure. Review in Hibiki with one schedule. Your Anki collection stays
        untouched.
      </p>
      <ol className="import-stages" aria-label="Import steps">
        {stages.map((label, i) => (
          <li key={label} aria-current={i === step ? 'step' : undefined}>
            {label}
          </li>
        ))}
      </ol>
      <p className="sr-only" role="status">
        Step {step + 1}: {stages[step]}
      </p>
      {step === 0 ? (
        <div className="import-stage">
          <h3>Choose a package</h3>
          <p>
            In Anki, select a deck, choose File → Export, then Anki Deck Package (.apkg). Include
            scheduling information if you want to classify by review interval. Exporting without
            media makes the file smaller.
          </p>
          <p>
            Analysis runs on your device. Only mapped text and selected deck names are sent when you
            check the preview or import. Audio, images, templates and Anki review history are
            excluded.
          </p>
          <p>
            Up to 128 MiB per package, 64 MiB expanded collection and 50,000 notes. Larger decks can
            be exported in parts.
          </p>
          <a href="https://docs.ankiweb.net/manual/exporting" target="_blank" rel="noreferrer">
            Anki export instructions
          </a>
          <label className="import-file">
            Anki package
            <input
              type="file"
              accept=".apkg"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void choose(f);
              }}
            />
          </label>
        </div>
      ) : null}
      {step === 1 && pkg ? (
        <div className="import-stage">
          <h3>Select decks and subdecks</h3>
          <p>
            {pkg.notes.length.toLocaleString()} notes · {pkg.models.length} note types ·{' '}
            {pkg.format}
          </p>
          <p>
            {pkg.scheduling
              ? 'Review intervals are available for some cards.'
              : 'No usable review intervals were found.'}{' '}
            {pkg.media
              ? 'This package contains media; Hibiki will import text only.'
              : 'Media is not imported.'}
          </p>
          <div className="collection-bulk-actions">
            <button className="text-button" onClick={() => setDecks(pkg.decks)}>
              Select all
            </button>
            <button className="text-button" onClick={() => setDecks([])}>
              Clear selection
            </button>
          </div>
          <fieldset>
            <legend>Included decks</legend>
            {pkg.decks.map((deck) => (
              <label className="import-choice" key={deck}>
                <input
                  type="checkbox"
                  checked={decks.includes(deck)}
                  onChange={(e) =>
                    setDecks((d) => (e.target.checked ? [...d, deck] : d.filter((x) => x !== deck)))
                  }
                />
                <span>
                  {deck.replaceAll('::', ' / ')}{' '}
                  <small>
                    ({pkg.notes.filter((n) => n.cards.some((c) => c.deck === deck)).length} notes)
                  </small>
                </span>
              </label>
            ))}
          </fieldset>
          <button className="button primary" disabled={!decks.length} onClick={next}>
            Map fields
          </button>
        </div>
      ) : null}
      {step === 2 ? (
        <div className="import-stage">
          <h3>Check the field suggestions</h3>
          <p>
            Suggestions recognize common Japanese Sentences, Refold and Lapis/Yomitan field names.
            Verify each note type against the sample. Only a Japanese word or expression is
            required.
          </p>
          {models.map((model) => (
            <fieldset key={model.id}>
              <legend>{model.name}</legend>
              <div className="import-mappings">
                {roles.map((role) => (
                  <label key={role}>
                    {labels[role]}
                    <select
                      value={maps[model.id]?.[role] ?? -1}
                      onChange={(e) =>
                        setMaps((m) => ({
                          ...m,
                          [model.id]: { ...m[model.id], [role]: Number(e.target.value) },
                        }))
                      }
                    >
                      <option value={-1}>
                        {role === 'term' ? 'Choose a required field' : 'Not imported'}
                      </option>
                      {model.fields.map((field, i) => (
                        <option key={i} value={i}>
                          {field}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              {pkg ? (
                <MappedSamples
                  records={
                    mappedRecords(
                      {
                        ...pkg,
                        notes: pkg.notes
                          .filter(
                            (n) =>
                              n.model === model.id && n.cards.some((c) => decks.includes(c.deck)),
                          )
                          .slice(0, 3),
                      },
                      decks,
                      maps,
                      'learning',
                      21,
                    ).records
                  }
                />
              ) : null}
            </fieldset>
          ))}
          <button className="button primary" disabled={invalid} onClick={next}>
            Choose classification
          </button>
          {invalid ? (
            <p>
              Map a usable Japanese word for every selected note type. A word may belong to at most
              eight selected decks.
            </p>
          ) : null}
        </div>
      ) : null}
      {step === 3 ? (
        <div className="import-stage">
          <h3>How should Hibiki classify new words?</h3>
          <fieldset>
            <legend>Initial word status</legend>
            {(['learning', 'known', 'interval'] as const).map((value) => (
              <label className="import-choice" key={value}>
                <input
                  type="radio"
                  name="classify"
                  value={value}
                  checked={mode === value}
                  disabled={value === 'interval' && !pkg?.scheduling}
                  onChange={() => setMode(value)}
                />
                {value === 'learning'
                  ? 'Save all as Learning'
                  : value === 'known'
                    ? 'Save all as Known'
                    : 'Use Anki review interval'}
              </label>
            ))}
          </fieldset>
          {mode === 'interval' ? (
            <label>
              Known interval cutoff (days)
              <input
                type="number"
                min="1"
                max="36500"
                value={Number.isFinite(cutoff) ? cutoff : ''}
                onChange={(e) => setCutoff(e.target.valueAsNumber)}
              />
            </label>
          ) : null}
          <p>
            Learning words start Hibiki’s own review schedule. Anki’s FSRS state and review history
            are not converted. Existing word choices and schedules are preserved.
          </p>
          <button className="button primary" disabled={invalid} onClick={next}>
            Preview import
          </button>
        </div>
      ) : null}
      {step === 4 ? (
        <div className="import-stage">
          <h3>Preview your import</h3>
          <p>
            {records.length} mapped contexts in this batch ·{' '}
            {records.filter((r) => r.state === 'known').length} chosen Known ·{' '}
            {records.filter((r) => r.state === 'learning').length} chosen Learning. Existing
            statuses take precedence.
          </p>
          <p>
            {mapped?.skipped ?? 0} notes skipped for missing, invalid or oversized text ·{' '}
            {mapped?.merged ?? 0} identical contexts merged.
          </p>
          <p>
            {packageAmbiguous.length} contexts share a word with different mapped content in this
            package. These are skipped unless you choose to add distinct contexts below.
          </p>
          {mode === 'interval' ? (
            <p>
              A word is Known only if every relevant selected card has a valid review interval of at
              least {cutoff} days. Otherwise it is Learning. {mapped?.missingIntervals ?? 0} mapped
              notes have incomplete or unsuitable intervals.
            </p>
          ) : null}
          <p>
            Imports run in batches of at most 500 contexts, with a daily account limit of 1,000 new
            contexts. You can continue with the next batch or repeat the package later.
          </p>
          <label className="import-choice">
            <input
              type="checkbox"
              checked={distinct}
              disabled={busy}
              onChange={(e) => {
                setDistinct(e.target.checked);
                setPreview(undefined);
              }}
            />
            Add a distinct context when a word already has a different reading, meaning or sentence.
            Otherwise skip ambiguous matches.
          </label>
          <MappedSamples records={records} />
          <button className="button" disabled={busy || invalid} onClick={() => void run(false)}>
            Check existing vocabulary
          </button>
          {preview ? (
            <>
              {preview.conflicts?.length ? (
                <details open>
                  <summary>Ambiguous matches (up to 20 shown)</summary>
                  <ul>
                    {preview.conflicts.map((c, i) => (
                      <li key={i}>
                        <strong lang="ja">{c.term}</strong>
                        <p>Incoming: {c.incoming || 'No meaning mapped'}</p>
                        <p>Already saved: {c.existing}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <p role="status">
                {preview.imported} new · {preview.duplicates} duplicates · {preview.ambiguous}{' '}
                ambiguous · {preview.skipped} skipped. Duplicate memberships are preserved without
                changing the word.
              </p>
              <p>
                New contexts: {preview.known} Known · {preview.learning} Learning.{' '}
                {preview.preserved} existing word choices preserved, including duplicates; Ignored
                and Unmarked choices stay unchanged.
              </p>
              <button className="button primary" disabled={busy} onClick={() => void run(true)}>
                Import {preview.imported} new contexts and preserve memberships
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {step === 5 && report ? (
        <div className="import-stage">
          <h3>Import complete</h3>
          <p role="status">
            {report.imported} imported · {report.duplicates} already saved · {report.skipped}{' '}
            skipped · 0 failed.
          </p>
          <p>
            New contexts: {report.known} Known · {report.learning} Learning. {report.preserved}{' '}
            existing choices preserved.
          </p>
          <p>
            D1 storage work for this batch: {report.rowsRead.toLocaleString()} rows read,{' '}
            {report.rowsWritten.toLocaleString()} rows written, including indexes.
          </p>
          <div className="collection-bulk-actions">
            <Link className="button primary" href="/vocabulary">
              Open learning overview
            </Link>
            <Link className="button" href="/review">
              Start review
            </Link>
            {(mapped?.records.length ?? 0) > offset + 500 ? (
              <button
                className="button"
                onClick={() => {
                  setOffset((n) => n + 500);
                  setPreview(undefined);
                  setReport(undefined);
                  setStep(4);
                }}
              >
                Preview next batch
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {busy ? (
        <div role="status">
          <p>
            {step === 0
              ? 'Inspecting package on this device…'
              : `${progress} / ${records.length} contexts processed…`}
          </p>
          {step !== 0 ? <progress max={records.length} value={progress} /> : null}
          <button
            className="text-button"
            onClick={() => {
              stop.current = true;
              if (step === 0) {
                cancel.current();
                setBusy(false);
              }
            }}
          >
            Pause
          </button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {step > 0 && step < 5 ? (
        <button
          className="text-button"
          disabled={busy}
          onClick={() => {
            setStep((s) => s - 1);
            setOffset(0);
            setPreview(undefined);
          }}
        >
          Back
        </button>
      ) : null}
    </section>
  );
}
function MappedSamples({ records }: { records: ReturnType<typeof mappedRecords>['records'] }) {
  return (
    <details open className="mapped-samples">
      <summary>Sample mapped words</summary>
      {records.slice(0, 3).map((r, i) => (
        <article key={i}>
          <strong lang="ja">{r.term}</strong> <span lang="ja">{r.reading}</span>
          <p>{r.translation || 'No meaning mapped'}</p>
          <p lang="ja">{r.sourceSentence || 'No example sentence mapped'}</p>
          <p>{r.sourceSentenceTranslation}</p>
        </article>
      ))}
    </details>
  );
}
