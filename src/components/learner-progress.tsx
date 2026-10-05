'use client';
import { useLearnerProfile } from './use-learner-profile';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Header, Footer, HelpDialog } from './chrome';
import { identityKey } from '@/lib/learner-progress';
import { timestamp } from '@/lib/youtube';
import { useAccount } from './account';

function practiceTime(seconds: number) {
  if (seconds < 60) return seconds > 0 ? 'Less than a minute' : 'No time recorded yet';
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
function activityDate(value: string) {
  return value === '1970-01-01T00:00:00.000Z'
    ? 'Earlier saved activity · date unknown'
    : new Date(value).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
}
export function LearnerProgress() {
  const account = useAccount();
  const { profile, available, warning } = useLearnerProfile();
  const [help, setHelp] = useState(false);
  return (
    <>
      <Header onHelp={() => setHelp(true)} />
      <main className="progress-main">
        <span className="eyebrow">YOUR PRACTICE, OVER TIME</span>
        <h1>Your progress</h1>
        <p className="progress-intro">
          {account.user
            ? 'Your account progress, saved locally as you practise and synced across devices.'
            : 'Saved on this device, in this browser. A history of your practice and the moments you returned to.'}
        </p>
        {warning ? (
          <p className="error-message" role="status">
            Progress for this visit may not be saved.
          </p>
        ) : null}
        {!profile ? (
          <p role="status">Opening your local progress…</p>
        ) : (
          <>
            {!profile.distinctLessons && !profile.comprehension.attempts && !profile.bookmarks ? (
              <section className="progress-panel progress-empty">
                <h2>A little practice starts here.</h2>
                <p>
                  Listen, replay a section, or reveal a translation. Your learning history will grow
                  as you practise.
                </p>
                <Link className="button primary" href="/practice/demo">
                  Try the demo
                  <ArrowRight size={16} />
                </Link>
              </section>
            ) : (
              <>
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
                </dl>
                <section className="progress-panel">
                  <h2>Content you usually practise</h2>
                  {profile.typicalContent ? (
                    <>
                      <p className="content-range">
                        Typical content: {profile.typicalContent.min}
                        {profile.typicalContent.min !== profile.typicalContent.max
                          ? `–${profile.typicalContent.max}`
                          : ''}
                      </p>
                      <p>
                        Based on {profile.typicalContent.lessons} recently practised, analyzed
                        lessons. This describes the content, not your Japanese ability.
                      </p>
                    </>
                  ) : (
                    <p>
                      After you practise at least five different lessons with difficulty estimates,
                      a typical content range will appear here.
                    </p>
                  )}
                  {profile.contentTrend ? (
                    <p>
                      {
                        {
                          harder: 'Recent content is getting a little harder.',
                          similar: 'Recent content is around the same range.',
                          easier: 'Recent content has been a little easier.',
                        }[profile.contentTrend]
                      }
                    </p>
                  ) : (
                    <p className="small muted">
                      A trend needs ten analyzed, practised lessons to compare two groups of five.
                    </p>
                  )}
                </section>
                <section className="progress-panel">
                  <h2>Your practice habits</h2>
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
                  </dl>
                  <p className="small muted">
                    Quiz evidence replays: {profile.evidenceReplays}. Recordings stay in memory and
                    are never saved in your history.
                  </p>
                </section>
              </>
            )}
            {profile.lessons.length ? (
              <section className="progress-panel">
                <h2>Recent lesson activity</h2>
                <ul className="progress-list">
                  {profile.lessons.slice(0, 20).map((l) => (
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
                          {activityDate(l.lastPractisedAt)} ·{' '}
                          {
                            {
                              upload: 'Your media',
                              demo: 'Studio sample',
                              youtube: 'YouTube',
                              vimeo: 'Vimeo',
                              direct: 'Direct video',
                            }[l.lesson.source]
                          }
                        </p>
                        <p>
                          {l.completed
                            ? 'Completed'
                            : l.practised
                              ? 'Practised'
                              : 'Earlier saved lesson'}{' '}
                          · {practiceTime(l.activeSeconds)} · {l.sessions} practice sessions
                        </p>
                        <p className="small muted">
                          {l.quizAttempts
                            ? `${l.quizCompleted} completed checks / ${l.quizAttempts} attempts`
                            : 'No comprehension check recorded'}
                          {l.difficulty
                            ? ` · Content ${l.difficulty.jlptMin}${l.difficulty.jlptMax !== l.difficulty.jlptMin ? `–${l.difficulty.jlptMax}` : ''}`
                            : ''}
                        </p>
                        {!available.includes(identityKey(l.lesson)) ? (
                          <p className="small muted">
                            This lesson transcript is no longer available in this browser.
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {profile.attention.length ? (
              <section className="progress-panel">
                <h2>Moments that needed more attention</h2>
                <p>These reasons describe your actions. They aren’t an ability score.</p>
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
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {profile.comprehension.attempts ? (
              <section className="progress-panel">
                <h2>Comprehension history</h2>
                <p>
                  Last 30 days: {profile.comprehension.recentCorrect} /{' '}
                  {profile.comprehension.recentTotal} correct in completed checks. Retakes remain
                  separate attempts.
                </p>
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
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <p className="progress-note">
              Active practice counts visible listening, recording, short spoken-response windows and
              deliberate interactions. Idle and hidden tabs, comprehension checks and
              difficulty-analysis waits are excluded. Earlier activity has no invented practice
              time. Your history stays local; clearing this browser’s data removes it.
            </p>
          </>
        )}
      </main>
      <Footer />
      <HelpDialog open={help} onClose={() => setHelp(false)} />
    </>
  );
}
