import { useState } from 'react';

import type { ProblemDetailPayload } from '../../../main/library-detail-repository.js';
import { highlightCode, type SupportedTheme } from './highlighter.js';
import { SanitizedHtml } from './SanitizedHtml.js';

export interface SubmissionsTabProps {
  readonly submissions: ProblemDetailPayload['submissions'];
  readonly theme: SupportedTheme;
}

export function SubmissionsTab({ submissions, theme }: SubmissionsTabProps) {
  const [openSourceFor, setOpenSourceFor] = useState<number | undefined>(
    undefined,
  );
  const [highlighted, setHighlighted] = useState<string | undefined>(undefined);

  const sorted = [...submissions.evaluations].sort((a, b) =>
    (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''),
  );

  async function revealSource(evId: number, language: string): Promise<void> {
    const body = submissions.sourceBodies[evId];
    if (!body) return;
    const html = await highlightCode(body, language, theme);
    setOpenSourceFor(evId);
    setHighlighted(html);
  }

  if (sorted.length === 0) {
    return (
      <section className="submissions-tab">
        <p className="submissions-tab__empty">
          No submissions archived for this problem.
        </p>
      </section>
    );
  }

  return (
    <section className="submissions-tab">
      <ol className="submissions-tab__timeline">
        {sorted.map((ev) => {
          const hasSource =
            ev.score === 100 && Boolean(submissions.sourceBodies[ev.evaluationId]);
          const viewLabel = hasSource
            ? 'View source'
            : `View source (score ${ev.score}, not archived)`;
          return (
            <li key={ev.evaluationId} className="submissions-tab__row">
              <div className="submissions-tab__meta">
                <span className={`pac-chip pac-chip--score-${ev.score}`}>
                  {ev.score}
                </span>
                <span>{ev.language}</span>
                {ev.verdict && <span>{ev.verdict}</span>}
                {ev.submittedAt && (
                  <time dateTime={ev.submittedAt}>
                    {ev.submittedAt.slice(0, 16).replace('T', ' ')}
                  </time>
                )}
                {typeof ev.runtime === 'number' && <span>{ev.runtime} ms</span>}
                {typeof ev.memory === 'number' && <span>{ev.memory} KB</span>}
              </div>
              <button
                type="button"
                className="pac-btn pac-btn--ghost"
                disabled={!hasSource}
                onClick={() => void revealSource(ev.evaluationId, ev.language)}
                aria-label={viewLabel}
              >
                {viewLabel}
              </button>
              {openSourceFor === ev.evaluationId && highlighted && (
                <SanitizedHtml
                  html={highlighted}
                  className="submissions-tab__source"
                  testId={`submissions-tab-source-${ev.evaluationId}`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
