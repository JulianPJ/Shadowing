'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Bookmark, Check, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { Header, Footer, HelpDialog } from './chrome';
import { useLibrary } from './use-library';
import { useLearnerProfile } from './use-learner-profile';
import { useAccount } from './account';
import { addQueueLink, pinLesson, saveLibrary } from '@/lib/library/client';
import { contentFit, type ContentFit } from '@/lib/library/model';
import { cachedDictionary } from '@/lib/dictionary/cache';
import { cachedReview } from '@/lib/review/client';
import { dueReviews } from '@/lib/review-scheduler';
import { lessonCompleted, loadDifficulty, saveDifficulty } from '@/lib/storage/learning';
import { saveLesson } from '@/lib/storage/lessons';
import { readStorage, storageAccount } from '@/lib/storage/browser';
import { loadKnowledge } from '@/lib/knowledge/client';
import { sourceLabel } from '@/lib/media';
import { lessonVocabulary } from '@/lib/knowledge/lesson';
import { validateDifficultyAnalysis } from '@/lib/difficulty';
import type { ContentDifficultyAnalysis, Lesson } from '@/lib/types';

type Recommendation = {
  lesson: Lesson;
  difficulty: ContentDifficultyAnalysis | null;
  fit: ContentFit;
};
// Public creator links are discovery prompts; caption availability and fit are checked on prepare.
const starters = [
  {
    title: 'Japanese in the park',
    author: 'Nihongo-Learning',
    url: 'https://www.youtube.com/watch?v=rjmKQ-fjnyQ',
  },
  {
    title: 'A short story about Pikachu',
    author: 'Comprehensible Japanese',
    url: 'https://www.youtube.com/watch?v=wwTl0SrnqTo',
  },
];
export function MyLibrary() {
  const account = useAccount();
  const router = useRouter();
  const { state, lessons, remote, ready } = useLibrary();
  const { profile } = useLearnerProfile();
  const [help, setHelp] = useState(false);
  const [filter, setFilter] = useState('all');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeKind, setNoticeKind] = useState<'success' | 'error' | 'info'>('info');
  const [findingStage, setFindingStage] = useState('');
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [finding, setFinding] = useState(false);
  const [discovered, setDiscovered] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);
  const [savedCounts, setSavedCounts] = useState<Record<string, number>>({});
  const [fits, setFits] = useState<Record<string, ContentFit>>({});
  const generation = useRef(0);
  useEffect(() => {
    const refresh = () => {
      setReviewCount(
        account.user ? dueReviews(cachedReview().cards, new Date().toISOString()).length : 0,
      );
      const counts: Record<string, number> = {};
      for (const record of Object.values(cachedDictionary().records)) {
        const id = record.entry.source.lessonId;
        counts[id] = (counts[id] ?? 0) + 1;
      }
      setSavedCounts(counts);
    };
    refresh();
    for (const event of [
      'hibiki:dictionary-change',
      'hibiki:review-change',
      'hibiki:account-change',
    ])
      window.addEventListener(event, refresh);
    return () => {
      for (const event of [
        'hibiki:dictionary-change',
        'hibiki:review-change',
        'hibiki:account-change',
      ])
        window.removeEventListener(event, refresh);
    };
  }, [account.user]);
  useEffect(() => {
    const epoch = generation;
    const changed = () => {
      epoch.current++;
      setRecommendations([]);
      setFits({});
      setDiscovered(false);
      setFinding(false);
    };
    window.addEventListener('hibiki:account-change', changed);
    window.addEventListener('hibiki:knowledge-change', changed);
    return () => {
      epoch.current++;
      window.removeEventListener('hibiki:account-change', changed);
      window.removeEventListener('hibiki:knowledge-change', changed);
    };
  }, []);
  function queue(inputUrl: string, inputTitle: string) {
    try {
      const saved = addQueueLink(inputUrl, inputTitle);
      setNoticeKind('success');
      setNotice(
        saved ? 'Saved to your queue.' : 'Queued for this visit. Browser storage is unavailable.',
      );
      setUrl('');
      setTitle('');
    } catch (error) {
      setNoticeKind('error');
      setNotice(error instanceof Error ? error.message : 'This link could not be queued.');
    }
  }
  async function findRecommendations() {
    const owner = storageAccount();
    const ticket = ++generation.current;
    const current = () => owner === storageAccount() && ticket === generation.current;
    setFinding(true);
    setFindingStage('Finding prepared lessons…');
    setNoticeKind('info');
    setNotice('');
    try {
      const response = await fetch('/api/discovery', {
        signal: AbortSignal.timeout(10000),
        cache: 'no-store',
      });
      const catalog = response.ok
        ? ((await response.json()) as {
            lessons?: Lesson[];
            difficulties?: ContentDifficultyAnalysis[];
          })
        : { lessons: [], difficulties: [] };
      if (!current()) return;
      const candidates = new Map(lessons.map((item) => [item.lesson.id, item.lesson]));
      for (const lesson of catalog.lessons ?? [])
        if (!candidates.has(lesson.id)) candidates.set(lesson.id, lesson);
      const next: Recommendation[] = [];
      const hasWordEvidence = Object.keys(loadKnowledge()).length >= 5;
      setFindingStage(
        hasWordEvidence
          ? 'Checking your marked words against lesson vocabulary…'
          : 'Checking available lesson information…',
      );
      for (const lesson of [...candidates.values()].slice(0, 20)) {
        if (
          lesson.segments.length > 500 ||
          lesson.segments.reduce((count, section) => count + section.japanese.length, 0) > 20000
        )
          continue;
        const coverage = hasWordEvidence ? await lessonVocabulary(lesson) : null;
        if (!current()) return;
        // Missing morphology must never turn a partial transcript into complete coverage.
        if (coverage && coverage.sections.length !== lesson.segments.length) continue;
        let difficulty = await loadDifficulty(lesson);
        const candidateDifficulty = (catalog.difficulties ?? []).find(
          (item) => item.lessonId === lesson.id,
        );
        if (candidateDifficulty) {
          try {
            difficulty = await validateDifficultyAnalysis(candidateDifficulty, lesson);
          } catch {
            /* Another locally imported revision must never inherit provider difficulty. */
          }
        }
        const levels = ['N5', 'N4', 'N3', 'N2', 'N1'];
        const above =
          !!difficulty &&
          !!profile?.typicalContent &&
          levels.indexOf(difficulty.overall.jlptMin) > levels.indexOf(profile.typicalContent.max);
        next.push({
          lesson,
          difficulty,
          fit: contentFit(coverage, difficulty?.overall.label, above),
        });
      }
      if (!current()) return;
      setFits(Object.fromEntries(next.map((item) => [item.lesson.id, item.fit])));
      setRecommendations(
        next
          .sort(
            (a, b) =>
              a.fit.rank - b.fit.rank || (b.fit.knownPercent ?? -1) - (a.fit.knownPercent ?? -1),
          )
          .slice(0, 8),
      );
      setDiscovered(true);
      if (!response.ok)
        setNotice('Public discovery is unavailable. Your prepared lessons are still available.');
    } catch {
      if (current())
        setNotice(
          'Recommendations are unavailable right now. Your library and queue are still here.',
        );
    } finally {
      if (current()) setFinding(false);
    }
  }
  async function start(item: Recommendation) {
    const owner = storageAccount();
    const previous = readStorage<number>(`position:${item.lesson.id}`, 0);
    saveLesson(
      item.lesson,
      Number.isSafeInteger(previous)
        ? Math.max(0, Math.min(item.lesson.segments.length - 1, previous))
        : 0,
    );
    if (item.difficulty) await saveDifficulty(item.difficulty, item.lesson);
    if (owner !== storageAccount()) return;
    router.push(`/practice/${encodeURIComponent(item.lesson.id)}`);
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
  return (
    <>
      <Header onHelp={() => setHelp(true)} />
      <main className="library-main">
        <span className="eyebrow">YOUR MEDIA, YOUR NEXT STEP</span>
        <h1>My Library</h1>
        <p className="library-intro">
          Continue a lesson, save something for later, or find a little stretch. Your queue and
          saved-library choices stay on this device
          {account.user ? ', separately for your account' : ''}.
        </p>
        <div className="library-utilities">
          <Link className="button" href="/review">
            Daily Review{account.user ? ` · ${reviewCount} due` : ''} <ArrowRight size={15} />
          </Link>
          <Link className="text-button" href="/progress">
            Your weekly report <ArrowRight size={15} />
          </Link>
        </div>
        {notice ? (
          <p
            className={`library-notice notice-${noticeKind}`}
            role={noticeKind === 'error' ? 'alert' : 'status'}
          >
            {notice}
          </p>
        ) : null}
        <section className="library-panel" aria-labelledby="library-lessons-title">
          <div className="section-heading">
            <h2 id="library-lessons-title">Your lessons</h2>
            <Link className="text-button" href="/">
              Add a video <Plus size={16} />
            </Link>
          </div>
          <p className="small muted">
            Prepared on this device. Your saved-library choices stay here; account lesson references
            appear below when they can be restored.
          </p>
          <div className="library-filters" role="group" aria-label="Filter library">
            {[
              ['all', 'All'],
              ['continue', 'Continue watching'],
              ['completed', 'Completed'],
              ['saved', 'Saved'],
            ].map(([value, label]) => (
              <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {label}
              </button>
            ))}
          </div>
          {!ready ? (
            <p role="status">Opening your library…</p>
          ) : !displayed.length ? (
            <p className="muted">
              {filter === 'saved'
                ? 'Save a lesson here to keep it close.'
                : 'No lessons in this view yet.'}{' '}
              <Link className="text-button" href="/practice/demo">
                Try the studio sample <ArrowRight size={14} />
              </Link>
            </p>
          ) : (
            <ul className="library-lesson-list">
              {displayed.map(({ lesson, index }) => (
                <li key={lesson.id}>
                  <div>
                    <Link
                      className="library-lesson-title"
                      href={`/practice/${encodeURIComponent(lesson.id)}`}
                    >
                      {lesson.title} <ArrowRight size={16} />
                    </Link>
                    <p className="small muted">
                      {sourceLabel(lesson)} · Section {index + 1} of {lesson.segments.length}
                      {lessonCompleted(lesson) ? ' · Completed' : ''}
                      {savedCounts[lesson.id]
                        ? ` · ${savedCounts[lesson.id]} cached saved words`
                        : ''}
                    </p>
                    <Link
                      className="text-button"
                      href={`/practice/${encodeURIComponent(lesson.id)}${lessonCompleted(lesson) ? `?section=${encodeURIComponent(lesson.segments[0].id)}` : ''}`}
                    >
                      {lessonCompleted(lesson) ? 'Practise again' : 'Resume practice'}{' '}
                      <ArrowRight size={14} />
                    </Link>
                    {fits[lesson.id] ? (
                      <p className="library-fit-line">
                        <span className="content-fit">{fits[lesson.id].label}</span>
                        {fits[lesson.id].knownPercent !== null
                          ? ` ${fits[lesson.id].knownPercent}% explicitly Known`
                          : ''}
                      </p>
                    ) : null}
                  </div>
                  <button
                    className="icon-button"
                    aria-label={`${state.pinned.includes(lesson.id) ? 'Remove' : 'Save'} ${lesson.title} ${state.pinned.includes(lesson.id) ? 'from' : 'to'} library`}
                    aria-pressed={state.pinned.includes(lesson.id)}
                    onClick={() => {
                      try {
                        pinLesson(lesson.id, !state.pinned.includes(lesson.id));
                      } catch (error) {
                        setNoticeKind('error');
                        setNotice((error as Error).message);
                      }
                    }}
                  >
                    <Bookmark
                      size={18}
                      fill={state.pinned.includes(lesson.id) ? 'currentColor' : 'none'}
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {remote
            .filter(
              (item) =>
                !lessons.some((l) => l.lesson.id === item.lesson.lessonId) &&
                (filter === 'all' ||
                  (filter === 'completed'
                    ? item.completed
                    : filter === 'continue'
                      ? !item.completed
                      : false)),
            )
            .map((item) => (
              <p className="library-remote" key={item.id}>
                <Link
                  className="text-button"
                  href={`/practice/${encodeURIComponent(item.lesson.lessonId)}`}
                >
                  {item.lesson.title} <ArrowRight size={14} />
                </Link>
                <span className="small muted">
                  {item.completed ? 'Completed' : `Section ${item.position + 1}`} ·{' '}
                  {item.mediaAvailable
                    ? 'Restore from your account'
                    : 'Reattach media or transcript'}
                </span>
              </p>
            ))}
        </section>
        <section className="library-panel" aria-labelledby="queue-title">
          <h2 id="queue-title">
            Watch later <span className="small muted">On this device</span>
          </h2>
          <p className="muted">
            Queue a link now. Japanese captions are checked when you prepare it; you can import a
            transcript when needed.
          </p>
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
                    <span className="small muted">
                      {new URL(item.url).hostname} · Vocabulary fit awaiting transcript
                    </span>
                  </div>
                  <Link className="button" href={`/?video=${encodeURIComponent(item.url)}`}>
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
            <p className="small muted library-queue-note">Your queue is empty. There is no rush.</p>
          )}
        </section>
        <section className="library-panel" aria-labelledby="recommendation-title">
          <div className="section-heading">
            <h2 id="recommendation-title">What to practise next</h2>
            <button
              className="button"
              disabled={finding}
              onClick={() => void findRecommendations()}
            >
              {finding ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
              {finding ? 'Finding your next lesson…' : 'Find my next lesson'}
            </button>
          </div>
          <p className="muted">
            Prepared lessons and public Japanese-captioned videos are matched against your explicit
            word states on this device. Difficulty describes the content; fit estimates vocabulary
            familiarity.
          </p>
          {finding ? (
            <p role="status">
              {findingStage} The first vocabulary check may take a moment to load the Japanese
              dictionary. You can keep using your Library.
            </p>
          ) : null}
          {recommendations.length ? (
            <div className="recommendation-grid">
              {recommendations.map((item) => (
                <article className="recommendation-card" key={item.lesson.id}>
                  <span
                    className={`content-fit fit-${item.fit.label.toLowerCase().replaceAll(' ', '-')}`}
                  >
                    {item.fit.label}
                  </span>
                  <h3>{item.lesson.title}</h3>
                  <p className="small muted">
                    {item.lesson.author} · {item.lesson.segments.length} sections
                  </p>
                  <p className="recommendation-reason">{item.fit.reason}</p>
                  <button className="text-button" onClick={() => void start(item)}>
                    Practise this lesson <ArrowRight size={15} />
                  </button>
                </article>
              ))}
            </div>
          ) : discovered ? (
            <p className="library-queue-note muted">
              No prepared public lessons are available yet. Add a video or choose a starter below.
            </p>
          ) : (
            <p className="library-queue-note small muted">
              This loads the local Japanese word analyser when needed. No transcript or word
              knowledge is sent to a recommendation model.
            </p>
          )}
          <h3 className="starter-heading">Public video starting points</h3>
          <p className="small muted">
            Creator videos to explore. Captions, availability and personal fit are checked when
            prepared.
          </p>
          <div className="starter-grid">
            {starters.map((item) => (
              <article className="starter-card" key={item.url}>
                <strong>{item.title}</strong>
                <span className="small muted">{item.author} · Fit unknown until prepared</span>
                <div>
                  <Link className="text-button" href={`/?video=${encodeURIComponent(item.url)}`}>
                    Prepare video <ArrowRight size={14} />
                  </Link>
                  <button className="text-button" onClick={() => queue(item.url, item.title)}>
                    Queue <Plus size={14} />
                  </button>
                  <a className="text-button" href={item.url} target="_blank" rel="noreferrer">
                    YouTube ↗
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
      <Footer />
      <HelpDialog open={help} onClose={() => setHelp(false)} />
    </>
  );
}
