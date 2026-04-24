import { useEffect, useState } from 'react';
import { X as CloseIcon } from 'lucide-react';

import type { DesktopBridge } from '../../shared/bridge.js';
import type { ProblemDetailPayload } from '../../main/library-detail-repository.js';
import { EditorialTab } from './tabs/EditorialTab.js';
import { OfficialSourceTab } from './tabs/OfficialSourceTab.js';
import { RawDataTab } from './tabs/RawDataTab.js';
import { StatementTab } from './tabs/StatementTab.js';
import { SubmissionsTab } from './tabs/SubmissionsTab.js';
import { TestsTab } from './tabs/TestsTab.js';

export type DrawerTabId =
  | 'statement'
  | 'tests'
  | 'submissions'
  | 'official'
  | 'editorial'
  | 'raw';

const TABS: ReadonlyArray<{ id: DrawerTabId; label: string }> = [
  { id: 'statement', label: 'Statement' },
  { id: 'tests', label: 'Tests' },
  { id: 'submissions', label: 'My submissions' },
  { id: 'official', label: 'Official source' },
  { id: 'editorial', label: 'Editorial' },
  { id: 'raw', label: 'Raw data' },
];

export interface ProblemDrawerProps {
  readonly bridge: DesktopBridge;
  readonly snapshotId: string | undefined;
  readonly problemId: string | undefined;
  readonly onClose: () => void;
  readonly theme?: 'light' | 'dark';
}

export function ProblemDrawer({
  bridge,
  snapshotId,
  problemId,
  onClose,
  theme = 'light',
}: ProblemDrawerProps) {
  const [detail, setDetail] = useState<ProblemDetailPayload | undefined>(
    undefined,
  );
  const [activeTab, setActiveTab] = useState<DrawerTabId>('statement');
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!problemId) {
      setDetail(undefined);
      setError(undefined);
      return;
    }
    let cancelled = false;
    setActiveTab('statement');
    void bridge.library
      .getDetail({ snapshotId, problemId: Number(problemId) })
      .then((result) => {
        if (cancelled) return;
        setDetail(result as ProblemDetailPayload);
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDetail(undefined);
        setError(
          err instanceof Error ? err.message : 'Failed to load problem detail',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, problemId, snapshotId]);

  if (!problemId) return null;

  return (
    <aside
      className="problem-drawer"
      role="dialog"
      aria-modal="true"
      aria-label={
        detail ? `Problem ${detail.problem.problemId}: ${detail.problem.name}` : 'Loading problem'
      }
    >
      <header className="problem-drawer__header">
        <div className="problem-drawer__title">
          {detail ? (
            <>
              <span className="problem-drawer__id">
                #{detail.problem.problemId}
              </span>
              <h2>{detail.problem.name}</h2>
            </>
          ) : (
            <h2>Loading…</h2>
          )}
        </div>
        <button
          type="button"
          className="pac-btn pac-btn--ghost problem-drawer__close"
          onClick={onClose}
          aria-label="Close problem drawer"
        >
          <CloseIcon size={20} strokeWidth={2.25} aria-hidden />
        </button>
      </header>
      <nav className="problem-drawer__tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`problem-drawer__tab${
              activeTab === tab.id ? ' problem-drawer__tab--active' : ''
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="problem-drawer__body">
        {error && <p role="alert" className="pac-banner">{error}</p>}
        {!error && !detail && <p>Loading problem…</p>}
        {detail && activeTab === 'statement' && (
          <StatementTab problem={detail.problem} />
        )}
        {detail && activeTab === 'tests' && (
          <TestsTab bridge={bridge} tests={detail.tests} />
        )}
        {detail && activeTab === 'submissions' && (
          <SubmissionsTab
            submissions={detail.submissions}
            theme={theme}
          />
        )}
        {detail && activeTab === 'official' && (
          <OfficialSourceTab
            officialSource={detail.officialSource}
            theme={theme}
          />
        )}
        {detail && activeTab === 'editorial' && (
          <EditorialTab editorial={detail.editorial} />
        )}
        {detail && activeTab === 'raw' && (
          <RawDataTab bridge={bridge} rawPaths={detail.rawPaths} />
        )}
      </div>
    </aside>
  );
}
