'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Bookmark, Plus, Trash2 } from 'lucide-react';
import { useLibrary } from './use-library';
import { useAccount } from './account';
import { addQueueLink, pinLesson, saveLibrary, importDeviceQueue } from '@/lib/library/client';
import { hiddenAccountSaveCount } from '@/lib/discover/client';
import { cachedDictionary } from '@/lib/dictionary/cache';
import { lessonCompleted } from '@/lib/storage/learning';
import { sourceLabel } from '@/lib/media';

const filters = [
  ['all', 'All'],
  ['continue', 'Continue watching'],
  ['completed', 'Completed'],
  ['saved', 'Saved'],
] as const;
type Filter = (typeof filters)[number][0];

/** Home → Library: lessons on this device or account, plus the Watch Later queue. */
export function LibraryTab({ library }: { library: ReturnType<typeof useLibrary> }) {
  const account = useAccount();
  const { state, lessons, remote, ready } = library;
  const [filter, setFilter] = useState<Filter>('all');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeKind, setNoticeKind] = useState<'success' | 'error' | 'info'>('info');
  const [savedCounts, setSavedCounts] = useState<Record<string, number>>({});
  const hiddenSaves = account.user ? hiddenAccountSaveCount() : 0;
  useEffect(() => {
    const refresh = () => {
      const counts: Record<string, number> = {};
      for (const record of Object.values(cachedDictionary().records)) {
        const id = record.entry.source.lessonId;
        counts[id] = (counts[id] ?? 0) + 1;
      }
      setSavedCounts(counts);
    };
    refresh();
    window.addEventListener('hibiki:dictionary-change', refresh);
    window.addEventListener('hibiki:account-change', refresh);
    return () => {
      window.removeEventListener('hibiki:dictionary-change', refresh);
      window.removeEventListener('hibiki:account-change', refresh);
    };
  }, []);
  function report(kind: 'success' | 'error', message: string) {
    setNoticeKind(kind);
    setNotice(message);
  }
  function queue(inputUrl: string, inputTitle: string) {
    try {
      const saved = addQueueLink(inputUrl, inputTitle);
      report(
        'success',
        saved ? 'Saved to Watch Later.' : 'Saved for this visit. Browser storage is unavailable.',
      );
      setUrl('');
      setTitle('');
    } catch (error) {
      report('error', error instanceof Error ? error.message : 'This link could not be saved.');
    }
  }
  const displayed = lessons.filter(
    (item) =>
      filter === 'all' ||
      (filter === 'saved'
        ? state.pinned.includes(item.lesson.id)
        : filter === 'completed'
          ? lessonCompleted(item.lesson)
          : !lessonCompleted(item.lesson)),
  );
  const restorable = remote.filter(
    (item) =>
      !lessons.some((l) => l.lesson.id === item.lesson.lessonId) &&
      (filter === 'all' ||
        (filter === 'completed'
          ? item.completed
          : filter === 'continue'
            ? !item.completed
            : false)),
  );
  return (
    <div className="library-main">
      {notice ? (
        <p
          className={`library-notice notice-${noticeKind}`}
          role={noticeKind === 'error' ? 'alert' : 'status'}
        >
          {notice}
        </p>
      ) : null}
      <section className="library-panel" aria-labelledby="library-lessons-title">
        <h2 id="library-lessons-title">Your lessons</h2>
        <div className="library-filters" role="group" aria-label="Filter library">
          {filters.map(([value, label]) => (
            <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>
        {!ready ? (
          <p role="status">Opening your library…</p>
        ) : !displayed.length && !restorable.length ? (
          <p className="muted">
            {filter === 'saved'
              ? 'Bookmark a lesson to keep it here.'
              : 'No lessons here yet. Paste a link above or try the studio sample.'}{' '}
            <Link className="text-button" href="/practice/demo">
              Try the studio sample <ArrowRight size={14} />
            </Link>
          </p>
        ) : (
          <ul className="library-lesson-list">
            {displayed.map(({ lesson, index }) => {
              const pinned = state.pinned.includes(lesson.id);
              const completed = lessonCompleted(lesson);
              return (
                <li key={lesson.id}>
                  <div>
                    <Link
                      className="library-lesson-title"
                      href={`/practice/${encodeURIComponent(lesson.id)}${completed ? `?section=${encodeURIComponent(lesson.segments[0].id)}` : ''}`}
                    >
                      {lesson.title} <ArrowRight size={16} />
                    </Link>
                    <p className="small muted">
                      {sourceLabel(lesson)} ·{' '}
                      {completed
                        ? 'Completed'
                        : `Section ${index + 1} of ${lesson.segments.length}`}
                      {savedCounts[lesson.id]
                        ? ` · ${savedCounts[lesson.id]} saved ${savedCounts[lesson.id] === 1 ? 'word' : 'words'}`
                        : ''}
                    </p>
                  </div>
                  <button
                    className="icon-button"
                    aria-label={`${pinned ? 'Remove' : 'Save'} ${lesson.title} ${pinned ? 'from' : 'to'} library`}
                    aria-pressed={pinned}
                    onClick={() => {
                      try {
                        pinLesson(lesson.id, !pinned);
                      } catch (error) {
                        report('error', (error as Error).message);
                      }
                    }}
                  >
                    <Bookmark size={18} fill={pinned ? 'currentColor' : 'none'} />
                  </button>
                </li>
              );
            })}
            {restorable.map((item) => (
              <li key={item.id} className="library-remote">
                <div>
                  <Link
                    className="library-lesson-title"
                    href={`/practice/${encodeURIComponent(item.lesson.lessonId)}`}
                  >
                    {item.lesson.title} <ArrowRight size={16} />
                  </Link>
                  <p className="small muted">
                    {item.completed ? 'Completed' : `Section ${item.position + 1}`} ·{' '}
                    {item.mediaAvailable ? 'From your account' : 'Reattach media or transcript'}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="library-panel" aria-labelledby="queue-title">
        <h2 id="queue-title">Watch later</h2>
        {hiddenSaves > 0 ? (
          <p className="small muted" role="status">
            {hiddenSaves} more saved {hiddenSaves === 1 ? 'video is' : 'videos are'} in your account
            beyond this device’s 40-link list.
          </p>
        ) : null}
        <form
          className="queue-form"
          onSubmit={(event) => {
            event.preventDefault();
            queue(url, title);
          }}
        >
          <label>
            Video link
            <input
              required
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
            />
          </label>
          <label>
            Title (optional)
            <input
              maxLength={160}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="A video I want to practise"
            />
          </label>
          <button className="button" type="submit">
            <Plus size={16} /> Add to queue
          </button>
        </form>
        {state.queue.length ? (
          <ol className="library-queue">
            {state.queue.map((item, index) => (
              <li key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <span className="small muted">{new URL(item.url).hostname}</span>
                </div>
                <Link className="button" href={`/prepare?video=${encodeURIComponent(item.url)}`}>
                  Prepare <ArrowRight size={14} />
                </Link>
                <button
                  className="icon-button"
                  aria-label={`Move ${item.title} earlier`}
                  disabled={index === 0}
                  onClick={() => {
                    const queue = [...state.queue];
                    [queue[index - 1], queue[index]] = [queue[index], queue[index - 1]];
                    saveLibrary({ ...state, queue });
                  }}
                >
                  ↑
                </button>
                <button
                  className="icon-button"
                  aria-label={`Remove ${item.title} from queue`}
                  onClick={() =>
                    saveLibrary({ ...state, queue: state.queue.filter((q) => q.id !== item.id) })
                  }
                >
                  <Trash2 size={17} />
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="small muted library-queue-note">
            Nothing saved yet. Save videos from Discover or paste a link.
          </p>
        )}
        {account.user ? (
          <button
            className="text-button"
            onClick={() => {
              try {
                const count = importDeviceQueue();
                report(
                  'success',
                  `${count} device save${count === 1 ? '' : 's'} added to your account queue.`,
                );
              } catch (error) {
                report(
                  'error',
                  error instanceof Error ? error.message : 'Device saves could not be imported.',
                );
              }
            }}
          >
            Add this device’s anonymous saves to my account
          </button>
        ) : null}
      </section>
    </div>
  );
}
