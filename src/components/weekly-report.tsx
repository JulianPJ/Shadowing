'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Target } from 'lucide-react';
import { readStorage, writeStorage } from '@/lib/storage/browser';
import { loadLearnerHistory } from '@/lib/learner/persistence';
import { loadKnowledge } from '@/lib/knowledge/client';
import { cachedDictionary } from '@/lib/dictionary/cache';
import { reviewHistory } from '@/lib/review/history';
import { pendingReview } from '@/lib/review/client';
import { loadAllShadowingSessions } from '@/lib/shadowing-session';
import {
  validateGoal,
  weeklyReport,
  type Goal,
  type WeeklyReport as Report,
} from '@/lib/reports/weekly';

export function WeeklyReport() {
  const [report, setReport] = useState<Report | null>(null);
  const [goal, setGoal] = useState<Goal>({ version: 1, minutes: null });
  const [minutes, setMinutes] = useState('5');
  const [pending, setPending] = useState(0);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const refresh = () => {
      setReport(
        weeklyReport(
          {
            history: loadLearnerHistory(),
            reviews: reviewHistory(),
            saved: Object.values(cachedDictionary().records).map((r) => r.entry),
            knowledge: Object.values(loadKnowledge()),
            matches: loadAllShadowingSessions().flatMap((s) =>
              Object.values(s.recentAttempts ?? {}).flat(),
            ),
          },
          new Date().toISOString(),
        ),
      );
      setGoal(validateGoal(readStorage('goal:daily', null)));
      setPending(pendingReview().filter((op) => op.action === 'grade').length);
    };
    refresh();
    const events = [
      'hibiki:sync-hydrated',
      'hibiki:knowledge-change',
      'hibiki:dictionary-change',
      'hibiki:review-change',
      'hibiki:account-change',
      'hibiki:local-write',
      'storage',
    ];
    for (const event of events) window.addEventListener(event, refresh);
    const timer = setInterval(refresh, 60000);
    return () => {
      clearInterval(timer);
      for (const event of events) window.removeEventListener(event, refresh);
    };
  }, []);
  function saveGoal(value: number | null) {
    const next = validateGoal({ version: 1, minutes: value });
    const saved = writeStorage('goal:daily', next);
    setGoal(next);
    setNotice(
      saved
        ? value === null
          ? 'Daily goal turned off.'
          : 'Your daily goal is saved on this device.'
        : 'Your goal is available for this visit; browser storage is unavailable.',
    );
  }
  return (
    <section className="progress-panel weekly-report" aria-labelledby="weekly-report-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">A CALM LOOK BACK</span>
          <h2 id="weekly-report-title">Your week in Japanese</h2>
        </div>
        <Link className="text-button" href="/library">
          Choose your next lesson <ArrowRight size={14} />
        </Link>
      </div>
      {!report ? (
        <p role="status">Opening your weekly report…</p>
      ) : (
        <>
          <p className="small muted">
            {report.from} – {report.to} · last seven days · UTC practice days
          </p>
          <dl className="weekly-metrics">
            <div>
              <dt>Minutes practised</dt>
              <dd>{Math.round(report.activeSeconds / 60)}</dd>
            </div>
            <div>
              <dt>Sections revisited</dt>
              <dd>{report.sectionsPractised}</dd>
            </div>
            <div>
              <dt>Saved terms in device cache</dt>
              <dd>{report.savedTerms}</dd>
            </div>
            <div>
              <dt>Marked Known this week</dt>
              <dd>{report.markedKnown}</dd>
            </div>
            <div>
              <dt>Review recall</dt>
              <dd>{report.reviewRecall === null ? 'No answers yet' : `${report.reviewRecall}%`}</dd>
              <span>
                {report.reviewRemembered} Good/Easy of {report.reviewAnswers} self-rated answers
              </span>
            </div>
            <div>
              <dt>Average Shadowing Match</dt>
              <dd>
                {report.averageMatch === null ? 'No recorded matches' : `${report.averageMatch}%`}
              </dd>
              <span>{report.shadowingAttempts} analyzed attempts</span>
            </div>
          </dl>
          <p className="small muted">
            Practised content:{' '}
            {report.contentLevels.length
              ? report.contentLevels.join(', ')
              : 'No analyzed content in this period'}
            . {report.recordingAttempts} recording attempts in recent sessions.
          </p>
          {pending ? (
            <p className="small muted">
              {pending} review {pending === 1 ? 'answer is' : 'answers are'} waiting to sync; your
              self-ratings are included.
            </p>
          ) : null}
          <details className="weekly-evidence">
            <summary>How this report is counted</summary>
            <p className="small muted">
              Minutes use recorded active time, including retained daily totals. Sections count
              distinct sections explicitly replayed or recorded in sessions started and updated
              during these seven days; archived section totals have no reliable weekly date and are
              excluded. Saved terms reflect the bounded device dictionary cache, which may be a
              partial account view. Marked Known counts your current Known states updated this week,
              not a proven memory gain. Review recall is your chosen Good/Easy answers, not a
              retention prediction. Match describes recognizer text and recording pace, not a
              pronunciation grade. Review and Match histories begin when these features are used;
              older evidence is never invented.
            </p>
          </details>
          <div className="daily-goal">
            <div>
              <h3>
                <Target size={18} /> A little daily goal
              </h3>
              <p className="small muted">
                Optional, local to this device. A fresh invitation each day; no streaks or
                penalties.
              </p>
            </div>
            {goal.minutes === null ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  saveGoal(Number(minutes));
                }}
              >
                <label>
                  Minutes per day
                  <select value={minutes} onChange={(e) => setMinutes(e.target.value)}>
                    <option value="3">3 minutes</option>
                    <option value="5">5 minutes</option>
                    <option value="10">10 minutes</option>
                    <option value="15">15 minutes</option>
                    <option value="20">20 minutes</option>
                  </select>
                </label>
                <button className="button" type="submit">
                  Set a daily goal
                </button>
              </form>
            ) : (
              <div className="daily-goal-progress">
                <strong>
                  {Math.round(report.todaySeconds / 60)} / {goal.minutes} minutes today
                </strong>
                <progress
                  aria-label="Daily practice goal"
                  max={goal.minutes * 60}
                  value={Math.min(report.todaySeconds, goal.minutes * 60)}
                />
                <p className="small muted">
                  {report.todaySeconds >= goal.minutes * 60
                    ? 'You made room for Japanese today.'
                    : 'Any amount of practice is a useful step.'}
                </p>
                <button className="text-button" onClick={() => saveGoal(null)}>
                  Turn off daily goal
                </button>
              </div>
            )}
          </div>
          {notice ? (
            <p className="small muted" role="status">
              {notice}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
