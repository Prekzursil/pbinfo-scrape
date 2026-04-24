import { useEffect, useState } from 'react';

import type { DesktopBridge } from '../shared/bridge.js';
import type { GuiArchiveState } from '../shared/types.js';
import { EmptyStateWelcome } from './library-shell/EmptyStateWelcome.js';
import { LibraryShell } from './library-shell/LibraryShell.js';

export interface AppProps {
  desktop?: DesktopBridge;
}

export function App({ desktop }: AppProps) {
  const bridge = desktop ?? readWindowBridge();
  const [archiveState, setArchiveState] = useState<GuiArchiveState | undefined>(
    undefined,
  );
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>(
    'light',
  );
  const [errorMessage, setErrorMessage] = useState<string | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!bridge?.archive) {
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      try {
        const state = await bridge.archive.getState();
        if (!cancelled) {
          setArchiveState(state);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    })();
    const unsubscribe = bridge.archive.onChanged((event) => {
      setArchiveState((current) =>
        current
          ? {
              ...current,
              archiveRoot: event.archiveRoot,
              snapshotId: event.snapshotId,
              found: true,
            }
          : current,
      );
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bridge]);

  useEffect(() => {
    if (!bridge?.theme || typeof document === 'undefined') {
      return undefined;
    }
    void bridge.theme.get().then(({ effective }) => {
      document.documentElement.dataset.theme = effective;
      setEffectiveTheme(effective);
    });
    const unsubscribe = bridge.theme.onChanged(({ effective }) => {
      document.documentElement.dataset.theme = effective;
      setEffectiveTheme(effective);
    });
    return unsubscribe;
  }, [bridge]);

  if (!bridge) {
    return (
      <main className="app-fallback">
        <h1>Desktop bridge unavailable</h1>
        <p>
          The renderer was started without the Electron preload. Launch via{' '}
          <code>npm run desktop:dev</code> or the packaged executable.
        </p>
      </main>
    );
  }

  if (!archiveState) {
    return (
      <main className="app-loading">
        <p>Resolving archive…</p>
        {errorMessage && (
          <p role="alert" className="pac-banner">
            {errorMessage}
          </p>
        )}
      </main>
    );
  }

  if (!archiveState.found) {
    return (
      <EmptyStateWelcome
        probedPaths={archiveState.probedPaths}
        onRunInitialCrawl={() => {
          void bridge.operator.runFullRefresh({});
        }}
        onBrowseForArchive={() => {
          void bridge.archive.browseForRoot().then((result) => {
            if (!result.cancelled) {
              setArchiveState(result.state);
            }
          });
        }}
      />
    );
  }

  return (
    <LibraryShell
      bridge={bridge}
      archiveRoot={archiveState.archiveRoot ?? ''}
      snapshotId={archiveState.snapshotId}
      theme={effectiveTheme}
    />
  );
}

function readWindowBridge(): DesktopBridge | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return (window as Window & { pbinfoDesktop?: DesktopBridge }).pbinfoDesktop;
}
