'use client';
import { Sparkles } from 'lucide-react';
import type { ShadowingAggregate, ShadowingSessionSummary } from '@/lib/shadowing-session';

export function ShadowingCompletion({
  aggregate,
  summary,
  loading,
}: {
  aggregate: ShadowingAggregate;
  summary?: ShadowingSessionSummary;
  loading: boolean;
}) {
  return (
    <section className="shadowing-completion" aria-labelledby="shadowing-overall-title">
      <div className="shadowing-completion-heading">
        <div>
          <span className="small-label">SHADOWING SCORE</span>
          <h2 id="shadowing-overall-title">
            {aggregate.score} <span>/ 100</span>
          </h2>
        </div>
        <Sparkles size={20} aria-hidden="true" />
      </div>
      <p className="small muted">
        Scored {aggregate.scoredSections} of {aggregate.totalSections} shadowing sections
      </p>
      {summary ? (
        <div className="shadowing-summary-grid">
          <div>
            <strong>What went well</strong>
            <p>{summary.wentWell}</p>
          </div>
          <div>
            <strong>Keep working on</strong>
            <p>{summary.keepWorking}</p>
          </div>
        </div>
      ) : loading ? (
        <p className="small muted" role="status">
          Summarising your scored attempts…
        </p>
      ) : null}
    </section>
  );
}
