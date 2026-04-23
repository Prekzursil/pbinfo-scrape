import { useCallback, useEffect, useRef, useState } from 'react';

export interface BrowseViewerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowseViewerSnapshot {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface BrowseViewerBridge {
  attach: () => Promise<BrowseViewerSnapshot>;
  detach: () => Promise<void>;
  navigate: (url: string) => Promise<BrowseViewerSnapshot>;
  goBack: () => Promise<BrowseViewerSnapshot>;
  goForward: () => Promise<BrowseViewerSnapshot>;
  reload: () => Promise<BrowseViewerSnapshot>;
  setBounds: (bounds: BrowseViewerBounds) => Promise<void>;
  getSnapshot: () => Promise<BrowseViewerSnapshot>;
}

export interface BrowseViewerProps {
  bridge: BrowseViewerBridge;
  initialUrl?: string;
  boundsPollIntervalMs?: number;
  snapshotPollIntervalMs?: number;
}

/**
 * The Browse tab that hosts the embedded `WebContentsView`. The React layer
 * owns the URL bar + back/forward/reload chrome and a positioning `<div>`;
 * the main process owns the actual WebContents and receives `setBounds`
 * updates so the native view can be laid out above the host div on every
 * window resize.
 */
export function BrowseViewer({
  bridge,
  initialUrl,
  boundsPollIntervalMs,
  snapshotPollIntervalMs,
}: BrowseViewerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [urlInput, setUrlInput] = useState<string>(initialUrl ?? '');
  const [snapshot, setSnapshot] = useState<BrowseViewerSnapshot>({
    url: '',
    canGoBack: false,
    canGoForward: false,
  });
  const [error, setError] = useState<string | null>(null);
  const snapshotPollMs = snapshotPollIntervalMs ?? 1500;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await bridge.attach();
        if (!cancelled) {
          setSnapshot(next);
          if (!urlInput && next.url) {
            setUrlInput(next.url);
          }
        }
        if (initialUrl && !cancelled) {
          const navSnapshot = await bridge.navigate(initialUrl);
          if (!cancelled) {
            setSnapshot(navSnapshot);
            setUrlInput(initialUrl);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(describeError(e));
        }
      }
    })();

    return () => {
      cancelled = true;
      void bridge.detach().catch(() => {
        /* ignore — component is unmounting */
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }

    let active = true;
    const emitBounds = () => {
      if (!active) {
        return;
      }
      const rect = host.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return;
      }
      void bridge
        .setBounds({
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        })
        .catch(() => {
          /* bounds updates are best-effort */
        });
    };
    emitBounds();

    // ResizeObserver is not available in JSDOM and some older web runtimes;
    // fall back to the interval-based poller alone when it's missing.
    const observer =
      typeof window !== 'undefined' && typeof window.ResizeObserver === 'function'
        ? new window.ResizeObserver(() => emitBounds())
        : null;
    observer?.observe(host);
    const windowResize = () => emitBounds();
    window.addEventListener('resize', windowResize);
    const pollMs = Math.max(250, boundsPollIntervalMs ?? 1000);
    const interval = window.setInterval(emitBounds, pollMs);

    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener('resize', windowResize);
      window.clearInterval(interval);
    };
  }, [bridge, boundsPollIntervalMs]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void bridge
        .getSnapshot()
        .then((next) => {
          setSnapshot(next);
        })
        .catch(() => {
          /* ignore polling errors */
        });
    }, snapshotPollMs);
    return () => {
      window.clearInterval(interval);
    };
  }, [bridge, snapshotPollMs]);

  const onNavigate = useCallback(
    async (nextUrl: string) => {
      try {
        setError(null);
        const next = await bridge.navigate(nextUrl);
        setSnapshot(next);
      } catch (e) {
        setError(describeError(e));
      }
    },
    [bridge],
  );

  const onBack = useCallback(async () => {
    try {
      const next = await bridge.goBack();
      setSnapshot(next);
    } catch (e) {
      setError(describeError(e));
    }
  }, [bridge]);

  const onForward = useCallback(async () => {
    try {
      const next = await bridge.goForward();
      setSnapshot(next);
    } catch (e) {
      setError(describeError(e));
    }
  }, [bridge]);

  const onReload = useCallback(async () => {
    try {
      const next = await bridge.reload();
      setSnapshot(next);
    } catch (e) {
      setError(describeError(e));
    }
  }, [bridge]);

  const onSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (urlInput.trim().length === 0) {
        return;
      }
      void onNavigate(urlInput.trim());
    },
    [onNavigate, urlInput],
  );

  return (
    <section className="panel browse-viewer panel-workspace" aria-label="Embedded live-site viewer">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Live-site viewer</p>
          <h2>Browse</h2>
        </div>
      </div>

      <form className="browse-viewer-toolbar" onSubmit={onSubmit}>
        <button
          type="button"
          className="ghost-button"
          aria-label="Go back"
          disabled={!snapshot.canGoBack}
          onClick={() => void onBack()}
        >
          ←
        </button>
        <button
          type="button"
          className="ghost-button"
          aria-label="Go forward"
          disabled={!snapshot.canGoForward}
          onClick={() => void onForward()}
        >
          →
        </button>
        <button
          type="button"
          className="ghost-button"
          aria-label="Reload"
          onClick={() => void onReload()}
        >
          ↻
        </button>
        <input
          type="url"
          className="browse-viewer-url"
          aria-label="Address bar"
          placeholder="http://127.0.0.1:4173/probleme/3171/waterreserve"
          value={urlInput}
          onChange={(event) => setUrlInput(event.target.value)}
        />
        <button type="submit" className="ghost-button">
          Go
        </button>
      </form>

      {error ? <p className="browse-viewer-error">{error}</p> : null}

      <div
        ref={hostRef}
        data-browser-view-host
        className="browse-viewer-host"
        role="presentation"
      />

      <p className="summary-copy">
        Current: <span className="mono">{snapshot.url || 'about:blank'}</span>
      </p>
    </section>
  );
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown viewer error';
}
