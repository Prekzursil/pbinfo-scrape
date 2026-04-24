import { useCallback } from 'react';

import './library-shell.css';

export interface EmptyStateWelcomeProps {
  readonly probedPaths: readonly string[];
  readonly onRunInitialCrawl: () => void;
  readonly onBrowseForArchive: () => void;
}

export function EmptyStateWelcome(props: EmptyStateWelcomeProps) {
  const { probedPaths, onRunInitialCrawl, onBrowseForArchive } = props;

  const handleRun = useCallback(
    () => onRunInitialCrawl(),
    [onRunInitialCrawl],
  );
  const handleBrowse = useCallback(
    () => onBrowseForArchive(),
    [onBrowseForArchive],
  );

  return (
    <main
      className="empty-state-welcome"
      data-testid="empty-state-welcome"
    >
      <section className="empty-state-welcome__card">
        <h1>Welcome to Problem Archive Crawler</h1>
        <p className="empty-state-welcome__lede">
          We couldn&apos;t find an <code>archive/</code> folder next to this
          application. Two ways to get started:
        </p>
        <div className="empty-state-welcome__actions">
          <section>
            <h2>Build a fresh archive now</h2>
            <button
              type="button"
              className="pac-btn pac-btn--primary"
              onClick={handleRun}
            >
              Run the initial crawl
            </button>
            <p className="empty-state-welcome__hint">
              Signs in with your PBInfo credentials, crawls every problem, your
              submissions, editorial &amp; official source where visible, and
              writes everything to <code>archive/</code> next to this app.
              About 4–5 hours on a first run.
            </p>
          </section>
          <section>
            <h2>Point at an existing archive</h2>
            <button
              type="button"
              className="pac-btn pac-btn--secondary"
              onClick={handleBrowse}
            >
              Browse for archive/…
            </button>
          </section>
        </div>
        <details className="empty-state-welcome__probes">
          <summary>We tried these paths</summary>
          <ul>
            {probedPaths.map((probe) => (
              <li key={probe}>
                <code>{probe}</code>
              </li>
            ))}
          </ul>
        </details>
      </section>
    </main>
  );
}
