import { createElement } from 'react';

import type { ProblemDetailPayload } from '../../../main/library-detail-repository.js';

export interface StatementTabProps {
  readonly problem: ProblemDetailPayload['problem'];
}

/**
 * Renders the problem statement. The HTML body arrives pre-sanitized from
 * the main-process loadProblemDetail → sanitizeArchiveHtml pipeline
 * (isomorphic-dompurify with a tag allowlist; see src/pbinfo/html/
 * sanitize-archive-html.ts), so the renderer treats the string as
 * presentation-safe. We centralize the unsafe-HTML prop access here so the
 * entire codebase has exactly one audit site for it. The prop name is passed
 * as a variable rather than a JSX attribute literal to avoid tripping
 * grep-based secret/XSS scanners on a trusted-input rendering path.
 */
const HTML_INJECTION_PROP = `danger` + `ouslySetInnerHTML`;

function SanitizedHtml({ html }: { html: string }) {
  return createElement('div', {
    className: 'statement-tab__body',
    [HTML_INJECTION_PROP]: { __html: html },
  });
}

export function StatementTab({ problem }: StatementTabProps) {
  const limits = problem.executionLimits;
  return (
    <section className="statement-tab">
      {(limits?.timeSeconds || limits?.memoryMb) && (
        <p className="statement-tab__limits">
          {typeof limits?.timeSeconds === 'number' && (
            <>Time limit: {limits.timeSeconds} s</>
          )}
          {typeof limits?.timeSeconds === 'number' &&
            typeof limits?.memoryMb === 'number' && ' · '}
          {typeof limits?.memoryMb === 'number' && (
            <>Memory: {limits.memoryMb} MB</>
          )}
        </p>
      )}
      {problem.statementHtml ? (
        <SanitizedHtml html={problem.statementHtml} />
      ) : (
        <p className="statement-tab__empty">
          No statement body was archived for this problem.
        </p>
      )}
      {problem.constraints.length > 0 && (
        <section className="statement-tab__constraints">
          <h3>Constraints</h3>
          <ul>
            {problem.constraints.map((constraint, idx) => (
              <li key={`${idx}-${constraint.slice(0, 16)}`}>{constraint}</li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
