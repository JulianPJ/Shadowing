'use client';
import { ProFeatureNotice, useProAccess } from './pro-feature';
import { useLearnerProfile } from './use-learner-profile';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { TaskReturn } from './chrome';
import { identityKey } from '@/lib/learner/constants';
import { timestamp } from '@/lib/youtube';
import { useAccount, AccountSettings, SubscriptionOffer } from './account';
import { WeeklyReport } from './weekly-report';
import { SubtitleSources } from './subtitle-sources';
import { useEffect, useState } from 'react';
import { BANDS, type Preferences } from '@/lib/discover/types';
import {
  discoveryPreferences,
  practiceBand,
  saveDiscoveryPreferences,
} from '@/lib/discover/client';
import type { LearnerProfile } from '@/lib/learner-types';

function practiceTime(seconds: number) {
  if (seconds < 60) return seconds > 0 ? 'Less than a minute' : 'No time recorded yet';
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
function activityDate(value: string) {
  return value === '1970-01-01T00:00:00.000Z'
    ? 'Earlier practice'
    : new Date(value).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
}
const sourceNames = {
  upload: 'Your media',
  demo: 'Studio sample',
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  direct: 'Direct video',
  page: 'Web page',
} as const;

/** Profile: this week, recent lessons and moments to revisit, then account settings and subtitle sources. */
export function LearnerProgress() {
  const { isPro } = useProAccess('progress');
  return isPro ? (
    <LearnerProgressContent />
  ) : (
    <main className="progress-main">
      <TaskReturn />
      <h1>Your progress</h1>
      <SubscriptionOffer />
      <ProFeatureNotice feature="Detailed learning progress, weekly reports and daily goals" />
      <AccountSettings />
      <SubtitleSources />
    </main>
  );
}
function LearnerProgressContent() {
  const account = useAccount();
  const { profile, available, warning } = useLearnerProfile();
  const resumable = profile?.lessons.find((l) => available.includes(identityKey(l.lesson)));
  const empty =
    !!profile && !profile.distinctLessons && !profile.comprehension.attempts && !profile.bookmarks;
  return (
    <main className="progress-main">
      <TaskReturn />
      <h1>Your progress</h1>
      <p className="progress-intro">
        {account.user
          ? 'Synced with your account.'
          : 'Saved on this device. Sign in to keep it across devices.'}
      </p>
      <SubscriptionOffer />
      {warning ? (
        <p className="error-message" role="status">
          Progress for this visit may not be saved.
        </p>
      ) : null}
      {!profile ? (
        <p role="status">Opening your progress…</p>
      ) : empty ? (
        <>
          <section className="progress-panel progress-empty">
            <h2>A little practice starts here.</h2>
            <p>Listen, replay a section or reveal a translation, and your history will grow.</p>
            <Link className="button primary" href="/practice/demo">
              Try the demo
              <ArrowRight size={16} />
            </Link>
          </section>
          <WeeklyReport />
        </>
      ) : (
        <>
          <div className="progress-next-actions">
            {resumable ? (
              <Link
                className="button primary"
                href={`/practice/${encodeURIComponent(resumable.lesson.lessonId)}?transcript=${resumable.lesson.transcriptKey}`}
              >
                Resume practice <ArrowRight size={16} />
              </Link>
            ) : (
              <Link className="button primary" href="/library">
                Choose a lesson <ArrowRight size={16} />
              </Link>
            )}
            <Link className="text-button" href="/review">
              Review words <ArrowRight size={16} />
            </Link>
          </div>
          <WeeklyReport />
          <dl className="progress-summary">
            <div>
              <dt>Active practice</dt>
              <dd>{practiceTime(profile.activeSeconds)}</dd>
              <span>Last 30 days: {practiceTime(profile.recentActiveSeconds)}</span>
            </div>
            <div>
              <dt>Lessons practised</dt>
              <dd>{profile.distinctLessons}</dd>
              <span>{profile.completedLessons} completed</span>
            </div>
            <div>
              <dt>Comprehension</dt>
              <dd>
                {profile.comprehension.completed
                  ? `${profile.comprehension.correct} / ${profile.comprehension.total} correct`
                  : 'No completed checks yet'}
              </dd>
              <span>
                {profile.comprehension.completed} completed checks ·{' '}
                {profile.comprehension.attempts} attempts
              </span>
            </div>
            {profile.typicalContent ? (
              <div>
                <dt>Typical content</dt>
                <dd>
                  {profile.typicalContent.min}
                  {profile.typicalContent.min !== profile.typicalContent.max
                    ? `–${profile.typicalContent.max}`
                    : ''}
                </dd>
                <span>
                  {profile.contentTrend
                    ? {
                        harder: 'Getting a little harder',
                        similar: 'Around the same range',
                        easier: 'A little easier lately',
                      }[profile.contentTrend]
                    : 'Describes the content, not your level'}
                </span>
              </div>
            ) : null}
            <ContentLevel profile={profile} />
          </dl>
          {profile.attention.length ? (
            <section className="progress-panel">
              <h2>Moments to revisit</h2>
              <ul className="progress-list">
                {profile.attention.slice(0, 10).map((s) => (
                  <li key={`${s.lesson.lessonId}:${s.lesson.transcriptKey}:${s.sectionId}`}>
                    <div>
                      <strong>
                        {s.lesson.title} · {timestamp(s.start)}–{timestamp(s.end)}
                      </strong>
                      <div className="attention-reasons">
                        {s.reasons.map((reason) => (
                          <span key={reason}>{reason}</span>
                        ))}
                      </div>
                      {available.includes(identityKey(s.lesson)) ? (
                        <Link
                          className="text-button"
                          href={`/practice/${encodeURIComponent(s.lesson.lessonId)}?section=${encodeURIComponent(s.sectionId)}&transcript=${encodeURIComponent(s.lesson.transcriptKey)}`}
                        >
                          Replay section <ArrowRight size={14} />
                        </Link>
                      ) : (
                        <p className="small muted">
                          Open this lesson from <Link href="/library">your Library</Link> to replay
                          it.
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {profile.lessons.length ? (
            <section className="progress-panel">
              <h2>Recent lessons</h2>
              <ul className="progress-list">
                {profile.lessons.slice(0, 10).map((l) => (
                  <li key={`${l.lesson.lessonId}:${l.lesson.transcriptKey}`}>
                    <div>
                      {available.includes(identityKey(l.lesson)) ? (
                        <Link href={`/practice/${encodeURIComponent(l.lesson.lessonId)}`}>
                          {l.lesson.title}
                          <ArrowRight size={14} />
                        </Link>
                      ) : (
                        <strong>{l.lesson.title}</strong>
                      )}
                      <p>
                        {activityDate(l.lastPractisedAt)} · {sourceNames[l.lesson.source]} ·{' '}
                        {l.completed ? 'Completed' : l.practised ? 'Practised' : 'Opened'} ·{' '}
                        {practiceTime(l.activeSeconds)}
                        {l.difficulty
                          ? ` · ${l.difficulty.jlptMin}${l.difficulty.jlptMax !== l.difficulty.jlptMin ? `–${l.difficulty.jlptMax}` : ''}`
                          : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <details className="progress-panel progress-details">
            <summary>Practice details</summary>
            <dl className="progress-habits">
              <div>
                <dt>Explicit section replays</dt>
                <dd>{profile.replays}</dd>
              </div>
              <div>
                <dt>Translation reveals</dt>
                <dd>
                  {profile.translationReveals} · {profile.translationSections} sections helped
                </dd>
              </div>
              <div>
                <dt>Saved sections</dt>
                <dd>{profile.bookmarks}</dd>
              </div>
              <div>
                <dt>Recording attempts</dt>
                <dd>{profile.recordingAttempts}</dd>
              </div>
              <div>
                <dt>Quiz evidence replays</dt>
                <dd>{profile.evidenceReplays}</dd>
              </div>
            </dl>
            {profile.comprehension.history.length ? (
              <>
                <h3>Comprehension history</h3>
                <ul className="progress-list">
                  {profile.comprehension.history.slice(0, 20).map((a) => (
                    <li key={a.id}>
                      <div>
                        <strong>
                          {profile.lessons.find(
                            (l) =>
                              l.lesson.lessonId === a.lessonId &&
                              l.lesson.transcriptKey === a.transcriptKey,
                          )?.lesson.title ?? 'Earlier lesson'}
                        </strong>
                        <p>
                          {activityDate(a.updatedAt)} ·{' '}
                          {a.completedAt
                            ? `${a.score} / ${a.totalQuestions} correct`
                            : `${a.results.length} / ${a.totalQuestions} answered · In progress`}
                        </p>
                        {available.includes(
                          identityKey({ lessonId: a.lessonId, transcriptKey: a.transcriptKey }),
                        ) ? (
                          <Link
                            className="text-button"
                            href={`/practice/${encodeURIComponent(a.lessonId)}?quiz=open&transcript=${encodeURIComponent(a.transcriptKey)}`}
                          >
                            {a.completedAt ? 'Review check' : 'Resume check'}{' '}
                            <ArrowRight size={14} />
                          </Link>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </details>
        </>
      )}
      <AccountSettings />
      <SubtitleSources />
    </main>
  );
}

/** The level Discover starts from: estimated from practice unless the learner chooses one. */
function ContentLevel({ profile }: { profile: LearnerProfile }) {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  useEffect(() => {
    const load = () => setPreferences(discoveryPreferences());
    load();
    window.addEventListener('hibiki:discover-change', load);
    window.addEventListener('hibiki:account-change', load);
    return () => {
      window.removeEventListener('hibiki:discover-change', load);
      window.removeEventListener('hibiki:account-change', load);
    };
  }, []);
  if (!preferences) return null;
  const estimated = practiceBand(profile);
  const label = (band: string | null) => BANDS.find((b) => b[0] === band)?.[1] ?? null;
  return (
    <div className="progress-level">
      <dt>
        <label htmlFor="progress-level">Discover level</label>
      </dt>
      <dd>
        <select
          id="progress-level"
          value={preferences.preferredBand ?? 'auto'}
          onChange={(event) => {
            const preferredBand =
              event.target.value === 'auto'
                ? null
                : (event.target.value as Preferences['preferredBand']);
            const next = { ...discoveryPreferences(), preferredBand };
            saveDiscoveryPreferences(next);
            setPreferences(next);
          }}
        >
          <option value="auto">
            {estimated ? `Estimated: ${label(estimated)}` : 'Estimate from my practice'}
          </option>
          {BANDS.map(([band, name]) => (
            <option key={band} value={band}>
              {name}
            </option>
          ))}
        </select>
      </dd>
      <span>
        {preferences.preferredBand
          ? 'Chosen by you. Discover starts here.'
          : estimated
            ? 'From your completed lessons. Discover starts here.'
            : 'Complete two analysed lessons for an estimate.'}
      </span>
    </div>
  );
}
