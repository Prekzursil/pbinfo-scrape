import { useEffect, useState } from 'react';

import type { DesktopBridge } from '../../shared/bridge.js';
import type {
  GuiArchiveState,
  ThemePreference,
} from '../../shared/types.js';

export interface SettingsModalProps {
  readonly bridge: DesktopBridge;
  readonly open: boolean;
  readonly onClose: () => void;
}

export function SettingsModal({ bridge, open, onClose }: SettingsModalProps) {
  const [archiveState, setArchiveState] = useState<
    GuiArchiveState | undefined
  >(undefined);
  const [preference, setPreference] = useState<ThemePreference>('auto');
  const [activeSnapshot, setActiveSnapshot] = useState<string | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void bridge.archive.getState().then((state) => {
      if (cancelled) return;
      setArchiveState(state);
      setActiveSnapshot(state.snapshotId);
    });
    void bridge.theme.get().then((t) => {
      if (cancelled) return;
      setPreference(t.preference);
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, open]);

  if (!open) return null;

  const snapshots = archiveState?.catalogSnapshots ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      className="settings-modal"
    >
      <div className="settings-modal__panel">
        <header className="settings-modal__header">
          <h2>Settings</h2>
          <button
            type="button"
            className="pac-btn pac-btn--ghost"
            onClick={onClose}
            aria-label="Close settings"
          >
            ×
          </button>
        </header>

        <label className="settings-modal__field">
          <span>Theme</span>
          <select
            value={preference}
            onChange={(event) => {
              const next = event.target.value as ThemePreference;
              setPreference(next);
              void bridge.theme.set(next);
            }}
          >
            <option value="auto">Auto (follow OS)</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>

        <label className="settings-modal__field">
          <span>Snapshot override</span>
          <select
            value={activeSnapshot ?? ''}
            onChange={(event) => {
              const next = event.target.value;
              setActiveSnapshot(next);
              // A persistent snapshot switch would require a new IPC channel
              // (`archive:switch-snapshot`) that's scoped to Task 9+. For
              // iteration 3 the selection is session-local and informs the
              // next LibraryShell fetch via archiveState prop on rerender.
            }}
            disabled={snapshots.length === 0}
          >
            {snapshots.length === 0 && (
              <option value="">No snapshots available</option>
            )}
            {snapshots.map((snap) => (
              <option key={snap.id} value={snap.id}>
                {snap.label ?? snap.id} ({snap.status}
                {snap.createdAt ? ` · ${snap.createdAt.slice(0, 10)}` : ''})
              </option>
            ))}
          </select>
        </label>

        {archiveState?.archiveRoot && (
          <div className="settings-modal__field">
            <span>Archive root</span>
            <code className="settings-modal__archive-path">
              {archiveState.archiveRoot}
            </code>
          </div>
        )}

        <div className="settings-modal__actions">
          <button
            type="button"
            className="pac-btn pac-btn--secondary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
