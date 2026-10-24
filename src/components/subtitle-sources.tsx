'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ExternalLink, LoaderCircle, Search } from 'lucide-react';
import {
  JIMAKU,
  JIMAKU_ACCOUNT,
  JimakuError,
  entryUrl,
  jimakuFiles,
  jimakuKey,
  onJimakuKeyChange,
  removeJimakuKey,
  saveJimakuKey,
  searchJimaku,
  validKey,
  verifyJimakuKey,
  type JimakuEntry,
} from '@/lib/subtitle-sources/jimaku';
import {
  rankSubtitleFiles,
  type RankedFile,
  type SubtitleQuery,
} from '@/lib/subtitle-sources/match';

/** The Jimaku key on this device; `undefined` until the browser has been read. */
export function useJimakuKey() {
  return useSyncExternalStore(onJimakuKeyChange, jimakuKey, () => undefined);
}

const failure = (error: unknown, fallback: string) =>
  error instanceof JimakuError ? error.message : fallback;

function JimakuConnect({ onDone }: { onDone?: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function connect() {
    const key = value.trim();
    if (!validKey(key)) {
      setError('Paste the API key from your Jimaku account page.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await verifyJimakuKey(key);
      setValue('');
      saveJimakuKey(key);
      onDone?.();
    } catch (error) {
      setError(failure(error, 'Jimaku could not check this key. Try again.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="jimaku-connect">
      <label className="field-label">
        Jimaku API key
        <span className="small muted">
          Create a free account on{' '}
          <a href={JIMAKU_ACCOUNT} target="_blank" rel="noreferrer">
            jimaku.cc <ExternalLink size={11} />
          </a>{' '}
          and copy the API key from your account page.
        </span>
        <input
          className="text-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          maxLength={256}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void connect();
          }}
        />
      </label>
      <button
        type="button"
        className="button"
        disabled={busy || !value.trim()}
        onClick={() => void connect()}
      >
        {busy ? <LoaderCircle className="spin" size={15} /> : null}
        Connect Jimaku
      </button>
      {error ? (
        <p role="alert" className="error-message">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Profile: the subtitle directories Hibiki searches when a video has no Japanese subtitles. */
export function SubtitleSources() {
  const key = useJimakuKey();
  const [replacing, setReplacing] = useState(false);
  return (
    <section
      className="account-settings subtitle-sources"
      id="subtitle-sources"
      aria-labelledby="subtitle-sources-title"
    >
      <h2 id="subtitle-sources-title">Subtitle sources</h2>
      <p className="muted">
        When a video has no Japanese subtitles, Hibiki searches these directories and loads the file
        for you, so there is nothing to download and upload.
      </p>
      <div className="subtitle-source">
        <p>
          <strong>Jimaku</strong>
          <span className="small muted">Japanese subtitles for anime and drama</span>
        </p>
        {key === undefined ? null : key && !replacing ? (
          <>
            <span className="account-plan pro">Connected on this device</span>
            <div className="account-actions">
              <button type="button" className="button" onClick={() => setReplacing(true)}>
                Replace key
              </button>
              <button type="button" className="button" onClick={removeJimakuKey}>
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <JimakuConnect onDone={() => setReplacing(false)} />
        )}
      </div>
      <p className="small muted">
        The key stays in this browser for this account and is sent only to Jimaku. It is not synced
        or included in your data download.
      </p>
    </section>
  );
}

export type JimakuChoice = { entry: JimakuEntry; file: RankedFile };
type Files = { files: RankedFile[]; archives: number; all: boolean };

const entryName = (entry: JimakuEntry) =>
  entry.english_name && entry.english_name !== entry.name
    ? `${entry.name} (${entry.english_name})`
    : entry.name;
const size = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Import dialog: searches Jimaku for the video's title and episode as soon as it opens, and
 * picks the best subtitle file. The learner can change the title, episode, series or file.
 */
export function JimakuSearch({
  initial,
  disabled,
  onChoice,
}: {
  initial: SubtitleQuery;
  disabled: boolean;
  onChoice: (choice: JimakuChoice | null) => void;
}) {
  const key = useJimakuKey();
  const [query, setQuery] = useState(initial.query);
  const [episode, setEpisode] = useState(initial.episode ? String(initial.episode) : '');
  const [entries, setEntries] = useState<JimakuEntry[] | null>(null);
  const [entry, setEntry] = useState<JimakuEntry | null>(null);
  const [files, setFiles] = useState<Files | null>(null);
  const [chosen, setChosen] = useState('');
  const [status, setStatus] = useState<'idle' | 'searching' | 'files'>('idle');
  const [error, setError] = useState<JimakuError | null>(null);
  const request = useRef<AbortController | null>(null);
  const searched = useRef(false);
  const loadedEpisode = useRef<number | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  function begin() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    return controller;
  }
  function choose(next: JimakuEntry | null, file: RankedFile | undefined) {
    setChosen(file?.url ?? '');
    onChoice(next && file ? { entry: next, file } : null);
  }
  const episodeNumber = () => {
    const value = Number(episode);
    return Number.isInteger(value) && value > 0 ? value : null;
  };

  async function openEntry(next: JimakuEntry, controller = begin(), all = false) {
    if (!key) return;
    setEntry(next);
    setFiles(null);
    choose(null, undefined);
    setStatus('files');
    setError(null);
    const number = all ? null : episodeNumber();
    loadedEpisode.current = number;
    try {
      let list = await jimakuFiles(key, next.id, number, controller.signal);
      // Jimaku matches episodes by file name; rank every file when its match finds none.
      if (number && !rankSubtitleFiles(list, number).files.length)
        list = await jimakuFiles(key, next.id, null, controller.signal);
      if (controller.signal.aborted) return;
      const ranked = rankSubtitleFiles(list, number);
      setFiles({ ...ranked, all });
      choose(next, ranked.files[0]);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof JimakuError ? error : new JimakuError('Jimaku search failed.'));
    } finally {
      if (request.current === controller) setStatus('idle');
    }
  }

  async function search(text: string, fallbacks: string[] = []) {
    if (!key || !text.trim()) return;
    const controller = begin();
    setStatus('searching');
    setError(null);
    setEntries(null);
    setEntry(null);
    setFiles(null);
    choose(null, undefined);
    try {
      let found: JimakuEntry[] = [];
      for (const candidate of [text, ...fallbacks]) {
        found = await searchJimaku(key, candidate, controller.signal);
        if (!found.length) continue;
        if (candidate !== text) setQuery(candidate);
        break;
      }
      if (controller.signal.aborted) return;
      setEntries(found.slice(0, 10));
      if (found[0]) await openEntry(found[0], controller);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof JimakuError ? error : new JimakuError('Jimaku search failed.'));
    } finally {
      if (request.current === controller) setStatus('idle');
    }
  }

  useEffect(() => {
    if (!key) return;
    // The first search tries each inferred title; a new key repeats the learner's search.
    if (searched.current) void search(query);
    else void search(initial.query, initial.alternatives);
    searched.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (key === undefined) return null;
  if (!key)
    return (
      <div className="jimaku-panel">
        <p className="small muted">
          Jimaku has Japanese subtitles for most anime and many dramas. Connect your free Jimaku
          account once and Hibiki searches it for every video without subtitles.
        </p>
        <JimakuConnect />
      </div>
    );

  const number = episodeNumber();
  const enter = (event: React.KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void search(query);
  };
  return (
    <div className="jimaku-panel">
      <div className="jimaku-search">
        <label className="field-label">
          Title
          <input
            className="text-input"
            value={query}
            maxLength={200}
            disabled={disabled}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={enter}
          />
        </label>
        <label className="field-label jimaku-episode">
          Episode
          <input
            className="text-input"
            inputMode="numeric"
            pattern="[0-9]*"
            value={episode}
            maxLength={4}
            disabled={disabled}
            onChange={(event) => setEpisode(event.target.value.replace(/\D/g, ''))}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              if (entry) void openEntry(entry);
              else void search(query);
            }}
            onBlur={() => {
              if (entry && status === 'idle' && loadedEpisode.current !== episodeNumber())
                void openEntry(entry);
            }}
          />
        </label>
        <button
          type="button"
          className="button"
          disabled={disabled || !query.trim()}
          onClick={() => void search(query)}
        >
          <Search size={15} /> Search
        </button>
      </div>

      {status !== 'idle' ? (
        <p className="small muted" role="status">
          <LoaderCircle className="spin" size={14} />{' '}
          {status === 'searching' ? 'Searching Jimaku…' : 'Finding the episode’s subtitles…'}
        </p>
      ) : null}
      {entries && !entries.length && status === 'idle' ? (
        <p className="small" role="status">
          Jimaku has no series matching “{query}”. Try its Japanese or English title.
        </p>
      ) : null}
      {entries && entries.length > 1 ? (
        <label className="field-label">
          Series
          <select
            className="text-input"
            value={entry?.id ?? ''}
            disabled={disabled}
            onChange={(event) => {
              const next = entries.find((item) => item.id === Number(event.target.value));
              if (next) void openEntry(next);
            }}
          >
            {entries.map((item) => (
              <option key={item.id} value={item.id}>
                {entryName(item)}
              </option>
            ))}
          </select>
        </label>
      ) : entry ? (
        <p className="small">
          Series: <strong>{entryName(entry)}</strong>
        </p>
      ) : null}

      {entry && files ? (
        files.files.length ? (
          <fieldset className="jimaku-files" disabled={disabled}>
            <legend>Subtitle file</legend>
            {files.files.slice(0, 20).map((file) => (
              <label key={file.url}>
                <input
                  type="radio"
                  name="jimaku-file"
                  checked={chosen === file.url}
                  onChange={() => choose(entry, file)}
                />
                <span>{file.name}</span>
                <span className="small muted">{size(file.size)}</span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="small" role="status">
            {number && !files.all
              ? `No subtitle file for episode ${number} in this series.`
              : 'This series has no subtitle files Hibiki can open.'}{' '}
            {files.archives
              ? `Jimaku also has ${files.archives === 1 ? 'an archive' : `${files.archives} archives`}: download and extract one, then upload its file.`
              : ''}{' '}
            {number && !files.all ? (
              <button
                type="button"
                className="text-button"
                onClick={() => void openEntry(entry, begin(), true)}
              >
                Show every file
              </button>
            ) : null}{' '}
            <a href={entryUrl(entry)} target="_blank" rel="noreferrer">
              Open on Jimaku <ExternalLink size={12} />
            </a>
          </p>
        )
      ) : null}

      {error ? (
        <div role="alert" className="error-message">
          {error.message}
        </div>
      ) : null}
      {error?.status === 401 ? <JimakuConnect /> : null}
      <p className="small muted">
        Subtitles shared by the{' '}
        <a href={JIMAKU} target="_blank" rel="noreferrer">
          Jimaku
        </a>{' '}
        community. A file made for another release can be offset; adjust it with the playback offset
        in practice settings.
      </p>
    </div>
  );
}
