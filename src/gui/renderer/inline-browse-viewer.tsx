import { useCallback, useEffect, useRef, useState } from 'react';

export interface InlineBrowseViewerProps {
  /** Base URL of the running mirror server, e.g. http://127.0.0.1:4173/. When
   *  absent the viewer shows a "start mirror preview first" hint. */
  previewUrl?: string;
  onOpenExternal: (url: string) => Promise<unknown>;
  /** Optional initial path to load relative to previewUrl. */
  initialPath?: string;
}

/**
 * Iframe-based embedded live-site viewer. Pointed at the running local mirror
 * server; mirror routes (`/probleme/<id>/<slug>`, etc.) resolve locally with
 * archive-truth stubs for any uncaptured underlink. External links are
 * trapped via the `Open in OS browser` button rather than navigating the
 * iframe to third-party origins.
 */
export function InlineBrowseViewer({
  previewUrl,
  onOpenExternal,
  initialPath,
}: InlineBrowseViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [urlInput, setUrlInput] = useState<string>('');
  const [currentUrl, setCurrentUrl] = useState<string>('');

  useEffect(() => {
    if (!previewUrl) {
      return;
    }
    const target = initialPath
      ? new URL(initialPath.startsWith('/') ? initialPath : `/${initialPath}`, previewUrl).toString()
      : previewUrl;
    setUrlInput(target);
    setCurrentUrl(target);
  }, [previewUrl, initialPath]);

  const onBack = useCallback(() => {
    try {
      iframeRef.current?.contentWindow?.history.back();
    } catch {
      // cross-origin or unavailable — ignore
    }
  }, []);

  const onForward = useCallback(() => {
    try {
      iframeRef.current?.contentWindow?.history.forward();
    } catch {
      // cross-origin or unavailable — ignore
    }
  }, []);

  const onReload = useCallback(() => {
    if (!iframeRef.current) {
      return;
    }
    const src = iframeRef.current.src;
    iframeRef.current.src = src;
  }, []);

  const onHome = useCallback(() => {
    if (!previewUrl) {
      return;
    }
    setUrlInput(previewUrl);
    setCurrentUrl(previewUrl);
  }, [previewUrl]);

  const onSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = urlInput.trim();
      if (!trimmed) {
        return;
      }
      setCurrentUrl(trimmed);
    },
    [urlInput],
  );

  return (
    <section className="panel browse-viewer panel-workspace" aria-label="Embedded live-site viewer">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Live-site viewer</p>
          <h2>Browse</h2>
        </div>
        <span className="panel-chip">{previewUrl ? 'Mirror live' : 'Mirror offline'}</span>
      </div>

      <form className="browse-viewer-toolbar" onSubmit={onSubmit}>
        <button
          type="button"
          className="ghost-button"
          aria-label="Go back"
          onClick={onBack}
          disabled={!currentUrl}
        >
          ←
        </button>
        <button
          type="button"
          className="ghost-button"
          aria-label="Go forward"
          onClick={onForward}
          disabled={!currentUrl}
        >
          →
        </button>
        <button
          type="button"
          className="ghost-button"
          aria-label="Reload"
          onClick={onReload}
          disabled={!currentUrl}
        >
          ↻
        </button>
        <button
          type="button"
          className="ghost-button"
          aria-label="Home"
          onClick={onHome}
          disabled={!previewUrl}
        >
          ⌂
        </button>
        <input
          type="text"
          className="browse-viewer-url mono"
          aria-label="Address bar"
          placeholder={previewUrl ?? 'Start the mirror preview on the Overview tab first'}
          value={urlInput}
          onChange={(event) => setUrlInput(event.target.value)}
          disabled={!previewUrl}
        />
        <button type="submit" className="ghost-button" disabled={!previewUrl}>
          Go
        </button>
        <button
          type="button"
          className="ghost-button"
          aria-label="Open current URL in OS browser"
          disabled={!currentUrl}
          onClick={() => {
            if (currentUrl) {
              void onOpenExternal(currentUrl);
            }
          }}
        >
          Open in OS browser
        </button>
      </form>

      {currentUrl ? (
        <iframe
          ref={iframeRef}
          src={currentUrl}
          title="Live-site viewer"
          className="browse-viewer-iframe"
          style={{
            width: '100%',
            minHeight: '520px',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '10px',
            background: '#0e1014',
          }}
          sandbox="allow-same-origin allow-forms allow-scripts allow-popups"
        />
      ) : (
        <p className="summary-copy">
          Start the mirror preview on the Overview tab first — the viewer will then
          load mirrored problem pages like <span className="mono">/probleme/3171/waterreserve</span>,
          following underlinks locally and redirecting to the archive-truth stub for
          any uncaptured route. Off-origin links should be opened in your OS browser
          via the toolbar.
        </p>
      )}
    </section>
  );
}
