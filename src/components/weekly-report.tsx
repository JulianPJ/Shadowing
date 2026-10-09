'use client';
import { useEffect, useState } from 'react';
import { Target } from 'lucide-react';
import { readStorage, writeStorage } from '@/lib/storage/browser';
import { loadLearnerHistory } from '@/lib/learner/persistence';
import { loadKnowledge } from '@/lib/knowledge/client';
import { cachedDictionary } from '@/lib/dictionary/cache';
import { reviewHistory } from '@/lib/review/history';
import { loadAllShadowingSessions } from '@/lib/shadowing-session';
import { studyTimeZone } from '@/lib/study-day';
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
  const [notice, setNotice] = useState('');
  const [editingGoal, setEditingGoal] = useState(false);
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
          studyTimeZone(),
        ),
      );
      setGoal(validateGoal(readStorage('goal:daily', null)));
    };
    refresh();
    const events = [
      'hibiki:sync-hydrated',
      'hibiki:knowledge-change',
      'hibiki:dictionary-change',
      'hibiki:review-change',
      'hibiki:account-change',
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
    setEditingGoal(false);
    setNotice(
      saved ? '' : 'Your goal is available for this visit; browser storage is unavailable.',
    );
  }
  return (
    <section className="progress-panel weekly-report" aria-labelledby="weekly-report-title">
      <h2 id="weekly-report-title">This week</h2>
      {!report ? (
        <p role="status">Opening your week…</p>
      ) : (
        <>
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
              <dt>Words known</dt>
              <dd>{report.markedKnown}</dd>
            </div>
            <div>
              <dt>Review recall</dt>
              <dd>{report.reviewRecall === null ? '—' : `${report.reviewRecall}%`}</dd>
              {report.reviewAnswers ? (
                <span>
                  {report.reviewRemembered} of {report.reviewAnswers} remembered
                </span>
              ) : null}
            </div>
          </dl>
          <div className="daily-goal">
            <h3>
              <Target size={18} /> Daily goal
            </h3>
            {goal.minutes === null || editingGoal ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  saveGoal(Number(minutes));
                }}
              >
                <label>
                  Minutes per day
                  <select value={minutes} onChange={(e) => setMinutes(e.target.value)}>
                    {[3, 5, 10, 15, 20].map((value) => (
                      <option key={value} value={value}>
                        {value} minutes
                      </option>
                    ))}
                  </select>
                </label>
                <button className="button" type="submit">
                  {goal.minutes === null ? 'Set a daily goal' : 'Save daily goal'}
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
                <button
                  className="text-button"
                  onClick={() => {
                    setMinutes(String(goal.minutes));
                    setEditingGoal(true);
                  }}
                >
                  Edit daily goal
                </button>
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
