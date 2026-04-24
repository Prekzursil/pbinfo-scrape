import { useState } from 'react';

import type { RefreshProgressEvent } from '../../shared/bridge.js';

export interface ProgressPanelProps {
  readonly event: RefreshProgressEvent | undefined;
  readonly onCancel?: () => void;
}

const PHASES = [
  'auth',
  'crawl-list',
  'crawl-detail',
  'normalize',
  'rank',
  'materialize',
  'mirror',
  'finalize',
] as const;

const PHASE_LABELS: Record<(typeof PHASES)[number], string> = {
  auth: 'Auth',
  'crawl-list': 'Crawl list',
  'crawl-detail': 'Crawl detail',
  normalize: 'Normalize',
  rank: 'Rank',
  materialize: 'Materialize',
  mirror: 'Mirror',
  finalize: 'Finalize',
};

export function ProgressPanel({ event, onCancel }: ProgressPanelProps) {
  const [confirmCancel, setConfirmCancel] = useState(false);

  if (!event) return null;

  const activeIdx = PHASES.indexOf(event.phase);
  const pct = event.total
    ? Math.min(100, Math.round((event.processed / event.total) * 100))
    : 0;

  return (
    <section className="progress-panel" aria-live="polite">
      <ol className="progress-panel__phases">
        {PHASES.map((phase, idx) => {
          const modifier =
            idx < activeIdx
              ? 'done'
              : idx === activeIdx
                ? 'active'
                : 'pending';
          return (
            <li
              key={phase}
              className={`progress-panel__phase progress-panel__phase--${modifier}`}
              aria-current={idx === activeIdx ? 'step' : undefined}
            >
              {PHASE_LABELS[phase]}
            </li>
          );
        })}
      </ol>
      <div className="progress-panel__card">
        <header>
          <strong>Phase: {PHASE_LABELS[event.phase]}</strong>
          {typeof event.etaSeconds === 'number' && (
            <span>{formatEta(event.etaSeconds)} remaining</span>
          )}
        </header>
        <div className="progress-panel__counter">
          {event.processed.toLocaleString()}
          {typeof event.total === 'number' &&
            ` / ${event.total.toLocaleString()} (${pct}%)`}
        </div>
        <div
          className="progress-panel__bar"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="progress-panel__bar-fill"
            style={{ width: `${pct}%` }}
          />
        </div>
        {event.lastItem && (
          <p className="progress-panel__last">Last: {event.lastItem}</p>
        )}
        {event.message && (
          <p className="progress-panel__message">{event.message}</p>
        )}
      </div>
      {onCancel && event.phase !== 'finalize' && (
        <div className="progress-panel__actions">
          {!confirmCancel ? (
            <button
              type="button"
              className="pac-btn pac-btn--danger-ghost"
              onClick={() => setConfirmCancel(true)}
            >
              Cancel crawl
            </button>
          ) : (
            <>
              <span>Are you sure?</span>
              <button
                type="button"
                className="pac-btn pac-btn--danger"
                onClick={() => {
                  onCancel();
                  setConfirmCancel(false);
                }}
              >
                Yes, cancel
              </button>
              <button
                type="button"
                className="pac-btn pac-btn--ghost"
                onClick={() => setConfirmCancel(false)}
              >
                Keep running
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes - hours * 60;
  return `${hours} h ${rem} m`;
}
