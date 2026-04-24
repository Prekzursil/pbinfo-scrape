import { useEffect, useRef, useState } from 'react';

import type {
  DesktopBridge,
  RefreshProgressEvent,
} from '../../shared/bridge.js';

export interface OperatorMenuProps {
  readonly bridge: DesktopBridge;
  readonly sessionLabel?: string;
  readonly onReauthenticate: () => void;
  readonly onRunFullRefresh: () => void;
  readonly onOpenDataExplorer: () => void;
  readonly onOpenLiveSiteViewer: () => void;
  readonly onOpenSettings: () => void;
}

export function OperatorMenu(props: OperatorMenuProps) {
  const [open, setOpen] = useState(false);
  const [jobActive, setJobActive] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = props.bridge.operator.onProgress((event) => {
      setJobActive(event.phase !== 'finalize');
    });
    return unsub;
  }, [props.bridge]);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (event: MouseEvent): void => {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const close = (): void => setOpen(false);

  return (
    <div className="operator-menu">
      <button
        type="button"
        className="pac-btn pac-btn--ghost operator-menu__trigger"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Operator ▾
      </button>
      {open && (
        <div
          ref={panelRef}
          role="menu"
          aria-label="Operator actions"
          className="operator-menu__panel"
        >
          <div className="operator-menu__section operator-menu__session">
            {props.sessionLabel && (
              <p className="operator-menu__session-label">
                {props.sessionLabel}
              </p>
            )}
            <button
              role="menuitem"
              type="button"
              className="pac-btn pac-btn--ghost"
              onClick={() => {
                props.onReauthenticate();
                close();
              }}
            >
              Re-authenticate
            </button>
          </div>
          <hr className="operator-menu__divider" />
          <div className="operator-menu__section operator-menu__destructive">
            <button
              role="menuitem"
              type="button"
              className="pac-btn pac-btn--primary"
              disabled={jobActive}
              aria-disabled={jobActive}
              title={jobActive ? 'Refresh already in progress' : undefined}
              onClick={() => {
                props.onRunFullRefresh();
                close();
              }}
            >
              🔄 Run full refresh
              <br />
              <small>Crawl → normalize → rank → materialize → mirror → finalize. ~4–5 h wall-clock.</small>
            </button>
          </div>
          <hr className="operator-menu__divider" />
          <div className="operator-menu__section operator-menu__explorers">
            <button
              role="menuitem"
              type="button"
              className="pac-btn pac-btn--ghost"
              onClick={() => {
                props.onOpenDataExplorer();
                close();
              }}
            >
              📊 Open data explorer
            </button>
            <button
              role="menuitem"
              type="button"
              className="pac-btn pac-btn--ghost"
              onClick={() => {
                props.onOpenLiveSiteViewer();
                close();
              }}
            >
              🌐 Open live-site viewer
            </button>
            <button
              role="menuitem"
              type="button"
              className="pac-btn pac-btn--ghost"
              onClick={() => {
                props.onOpenSettings();
                close();
              }}
            >
              ⚙ Settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
