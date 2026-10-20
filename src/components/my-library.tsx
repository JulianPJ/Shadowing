'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUp,
  Bookmark,
  CircleCheck,
  EyeOff,
  Paperclip,
  Play,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useLibrary } from './use-library';
import { useAccount } from './account';
import {
  addQueueLink,
  importDeviceQueue,
  pinLesson,
  removeLessonFromLibrary,
  restoreLessonToLibrary,
  saveLibrary,
} from '@/lib/library/client';
import { hiddenAccountSaveCount } from '@/lib/discover/client';
import { cachedDictionary } from '@/lib/dictionary/cache';
import { completeLesson, lessonCompleted } from '@/lib/storage/learning';
import { sourceLabel } from '@/lib/media';
import { parseYouTubeUrl } from '@/lib/youtube';
import { LessonThumbnail, lessonDuration } from './lesson-thumbnail';

const filters = [
  ['all', 'All'],
  ['continue', 'Continue watching'],
  ['completed', 'Completed'],
  ['saved', 'Saved'],
] as const;
type Filter = (typeof filters)[number][0];

/** Library: lesson cards on this device or account, plus the Watch Later queue. */
export function LibraryTab({ library }: { library: ReturnType<typeof useLibrary> }) {
  const account = useAccount();
  const { state, lessons, remote, ready } = library;
  const [filter, setFilterState] = useState<Filter>('all');
  useEffect(() => {
    const value = new URL(window.location.href).searchParams.get('filter');
    // The filter lives in the URL so Back from a lesson returns to it; it is read after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (filters.some(([key]) => key === value)) setFilterState(value as Filter);
  }, []);
  function setFilter(value: Filter) {
    setFilterState(value);
    const next = new URL(window.location.href);
    if (value === 'all') next.searchParams.delete('filter');
    else next.searchParams.set('filter', value);
    window.history.replaceState(window.history.state, '', next);
  }
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeKind, setNoticeKind] = useState<'success' | 'error' | 'info'>('info');
  const [undo, setUndo] = useState<{ id: string; pinned: boolean } | null>(null);
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
    setUndo(null);
  }
  function remove(id: string, title: string) {
    const pinned = state.pinned.includes(id);
    removeLessonFromLibrary(id);
    report('success', `Removed “${title}” from your Library. Your progress is kept.`);
    setUndo({ id, pinned });
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
  // The most recent unfinished lesson gets the one filled action in this region.
  const nextUp = displayed.find(({ lesson }) => !lessonCompleted(lesson))?.lesson.id;
  return (
    <div className="library-main library-layout">
      {notice ? (
        <p
          className={`library-notice notice-${noticeKind}`}
          role={noticeKind === 'error' ? 'alert' : 'status'}
        >
          {notice}
          {undo ? (
            <button
              className="text-button"
              onClick={() => {
                restoreLessonToLibrary(undo.id, undo.pinned);
                report('success', 'Restored to your Library.');
              }}
            >
              Undo
            </button>
          ) : null}
        </p>
      ) : null}
      <section className="library-panel library-lessons" aria-labelledby="library-lessons-title">
        <div className="library-panel-heading">
          <h2 id="library-lessons-title">Your lessons</h2>
          <div className="library-filters" role="group" aria-label="Filter library">
            {filters.map(([value, label]) => (
              <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {!ready ? (
          <p role="status">Opening your library…</p>
        ) : !displayed.length && !restorable.length ? (
          <p className="muted">
            {filter === 'saved'
              ? 'Bookmark a lesson to keep it here.'
              : filter === 'all'
                ? 'No lessons here yet. Add a video, or start with the studio sample.'
                : `No lessons match ${filters.find(([value]) => value === filter)![1]}.`}{' '}
            {filter === 'all' ? (
              <Link className="text-button" href="/practice/demo">
                Try the studio sample <ArrowRight size={14} />
              </Link>
            ) : (
              <button className="text-button" onClick={() => setFilter('all')}>
                Show all lessons <ArrowRight size={14} />
              </button>
            )}
          </p>
        ) : (
          <ul className="library-lesson-list library-card-grid">
            {displayed.map(({ lesson, index }) => {
              const pinned = state.pinned.includes(lesson.id);
              const completed = lessonCompleted(lesson);
              const href = `/practice/${encodeURIComponent(lesson.id)}${completed ? `?section=${encodeURIComponent(lesson.segments[0].id)}` : ''}`;
              const words = savedCounts[lesson.id];
              return (
                <li key={lesson.id} className="library-card">
                  <Link className="library-card-media" href={href} tabIndex={-1} aria-hidden="true">
                    <LessonThumbnail
                      source={lesson.source}
                      videoId={lesson.videoId}
                      duration={lessonDuration(lesson)}
                      progress={completed ? undefined : index / Math.max(1, lesson.segments.length)}
                    />
                  </Link>
                  <div className="library-card-body">
                    <h3>
                      <Link className="library-lesson-title" href={href}>
                        {lesson.title}
                      </Link>
                    </h3>
                    <p className="library-card-meta">
                      {sourceLabel(lesson)}
                      {words ? ` · ${words} saved ${words === 1 ? 'word' : 'words'}` : ''}
                    </p>
                    <p className={`library-card-state${completed ? ' completed' : ''}`}>
                      {completed ? (
                        <>
                          <CircleCheck size={16} /> Completed
                        </>
                      ) : (
                        `Section ${index + 1} of ${lesson.segments.length}`
                      )}
                    </p>
                    <div className="library-card-actions">
                      <Link
                        className={`button${lesson.id === nextUp ? ' primary' : ''}`}
                        href={href}
                      >
                        {completed ? (
                          <>
                            <RotateCcw size={16} /> Revisit
                          </>
                        ) : (
                          <>
                            <Play size={16} /> Resume
                          </>
                        )}
                      </Link>
                      <button
                        className="icon-button"
                        aria-label={`Save ${lesson.title} to library`}
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
                      <LessonMenu
                        title={lesson.title}
                        onComplete={
                          completed
                            ? undefined
                            : () => {
                                completeLesson(lesson);
                                window.dispatchEvent(new Event('hibiki:library-change'));
                                report('success', `Marked “${lesson.title}” complete.`);
                              }
                        }
                        onRemove={() => remove(lesson.id, lesson.title)}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
            {restorable.map((item) => {
              const href = `/practice/${encodeURIComponent(item.lesson.lessonId)}`;
              return (
                <li key={item.id} className="library-card library-remote">
                  <Link className="library-card-media" href={href} tabIndex={-1} aria-hidden="true">
                    <LessonThumbnail
                      source={item.lesson.source}
                      videoId={item.lesson.videoId ?? item.providerMediaId}
                      duration={item.lesson.duration}
                      progress={
                        item.completed
                          ? undefined
                          : item.position / Math.max(1, item.lesson.segmentCount)
                      }
                    />
                  </Link>
                  <div className="library-card-body">
                    <h3>
                      <Link className="library-lesson-title" href={href}>
                        {item.lesson.title}
                      </Link>
                    </h3>
                    <p className="library-card-meta">From your account</p>
                    <p className={`library-card-state${item.completed ? ' completed' : ''}`}>
                      {item.completed
                        ? 'Completed'
                        : `Section ${item.position + 1} of ${item.lesson.segmentCount}`}
                      {item.mediaAvailable ? null : <span> · Reattach media or transcript</span>}
                    </p>
                    <div className="library-card-actions">
                      <Link className="button" href={href}>
                        {item.mediaAvailable ? (
                          <>
                            <Play size={16} /> {item.completed ? 'Revisit' : 'Resume'}
                          </>
                        ) : (
                          <>
                            <Paperclip size={16} /> Reattach
                          </>
                        )}
                      </Link>
                      <LessonMenu
                        title={item.lesson.title}
                        onRemove={() => remove(item.lesson.lessonId, item.lesson.title)}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="library-panel library-watch-later" aria-labelledby="queue-title">
        <h2 id="queue-title">Watch later</h2>
        <p className="library-panel-intro">Saved to watch. Prepare a video when you are ready.</p>
        {hiddenSaves > 0 ? (
          <p className="small muted" role="status">
            {hiddenSaves} more saved {hiddenSaves === 1 ? 'video is' : 'videos are'} in your account
            beyond this device’s 40-link list.
          </p>
        ) : null}
        {state.queue.length ? (
          <ol className="library-queue">
            {state.queue.map((item, index) => {
              const href = `/prepare?video=${encodeURIComponent(item.url)}&from=library`;
              const videoId = youtubeId(item.url);
              return (
                <li key={item.id} className="library-queue-card">
                  <Link className="library-card-media" href={href} tabIndex={-1} aria-hidden="true">
                    <LessonThumbnail source={videoId ? 'youtube' : 'page'} videoId={videoId} />
                  </Link>
                  <div className="library-queue-copy">
                    <strong>{item.title}</strong>
                    <span className="library-card-meta">{new URL(item.url).hostname}</span>
                  </div>
                  <div className="library-card-actions">
                    <Link className="button" href={href}>
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
                      <ArrowUp size={17} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Remove ${item.title} from queue`}
                      onClick={() =>
                        saveLibrary({
                          ...state,
                          queue: state.queue.filter((q) => q.id !== item.id),
                        })
                      }
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="small muted library-queue-note">
            Nothing saved yet. Save videos from Discover or add a link below.
          </p>
        )}
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

/** Less frequent lesson actions, behind one ••• button so each card keeps a single main action. */
function LessonMenu({
  title,
  onComplete,
  onRemove,
}: {
  title: string;
  onComplete?: () => void;
  onRemove: () => void;
}) {
  const run = (action: () => void) => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.closest('details')?.removeAttribute('open');
    action();
  };
  return (
    <details className="library-card-menu">
      <summary className="icon-button" aria-label={`More actions for ${title}`}>
        •••
      </summary>
      <div>
        {onComplete ? (
          <button onClick={run(onComplete)}>
            <CircleCheck size={16} /> Mark complete
          </button>
        ) : null}
        <button onClick={run(onRemove)}>
          <EyeOff size={16} /> Remove from library
        </button>
      </div>
    </details>
  );
}

function youtubeId(url: string) {
  try {
    return parseYouTubeUrl(url);
  } catch {
    return undefined;
  }
}
