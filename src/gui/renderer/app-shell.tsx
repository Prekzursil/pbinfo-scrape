import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

import type {
  GuiArchiveDataset,
  GuiArchiveListing,
  GuiArchiveRecordDetail,
  GuiArchiveSummary,
  GuiCoverageDetail,
  GuiCoverageListing,
  GuiCoverageSummary,
  GuiCrawlMode,
  GuiCrawlStatus,
  GuiJobEvent,
  GuiJobRecord,
  GuiVerbosityMode,
  GuiWorkspaceState,
} from '../shared/types.js';
import type { DesktopCredentialLoginInput, DesktopBrowserImportInput } from '../shared/contracts.js';
import { CoverageExplorerPanel, type CoverageExplorerFilters } from './coverage-explorer.js';
import { DataExplorerPanel } from './data-explorer.js';
import { InlineBrowseViewer } from './inline-browse-viewer.js';

type AppShellView = 'home' | 'coverage' | 'browse' | 'data' | 'settings';

export interface AppShellProps {
  workspaceState: GuiWorkspaceState | null | undefined;
  jobs: GuiJobRecord[];
  crawlStatus: GuiCrawlStatus | null;
  jobEvents: GuiJobEvent[];
  selectedSnapshotId: string;
  selectedCrawlMode: GuiCrawlMode;
  verbosityMode: GuiVerbosityMode;
  busyAction: string | null;
  statusMessage: string | null;
  errorMessage: string | null;
  previewUrl?: string;
  previewJobId?: string;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
  onSnapshotChange: (snapshotId: string) => void;
  onCrawlModeChange: (mode: GuiCrawlMode) => void;
  onVerbosityChange: (mode: GuiVerbosityMode) => void;

  archiveSummary: GuiArchiveSummary | null;
  archiveListing: GuiArchiveListing | null;
  archiveRecordDetail: GuiArchiveRecordDetail | null;
  coverageSummary: GuiCoverageSummary | null;
  coverageListing: GuiCoverageListing | null;
  coverageDetail: GuiCoverageDetail | null;
  selectedCoverageProblemId: number | null;
  coverageFilters: CoverageExplorerFilters;
  selectedArchiveDataset: GuiArchiveDataset;
  selectedArchiveRecordId: string | null;
  archiveQuery: string;
  onCoverageFiltersChange: (filters: CoverageExplorerFilters) => void;
  onSelectCoverageProblem: (problemId: number) => void;
  onArchiveDatasetChange: (dataset: GuiArchiveDataset) => void;
  onArchiveQueryChange: (query: string) => void;
  onSelectArchiveRecord: (recordId: string) => void;

  onSelectWorkspace: (workspaceRoot: string) => Promise<unknown>;
  onRefresh: () => Promise<unknown>;
  onLoginProfile: (input: DesktopCredentialLoginInput) => Promise<unknown>;
  onImportBrowserProfile: (input: DesktopBrowserImportInput) => Promise<unknown>;
  onActivateProfile: (profileId: string) => Promise<unknown>;
  onDeleteProfile: (profileId: string) => Promise<unknown>;
  onStartCrawl: (scope: 'public' | 'user' | 'all') => Promise<unknown>;
  onPauseCrawl: (jobId: string) => Promise<unknown>;
  onResumeCrawl: (jobId: string) => Promise<unknown>;
  onRunSnapshotJob: (
    kind: 'normalize' | 'rank' | 'mirror-build' | 'snapshot-finalize',
  ) => Promise<unknown>;
  onStartMirrorPreview: () => Promise<unknown>;
  onStopMirrorPreview: (jobId: string) => Promise<unknown>;
  onOpenExternal: (url: string) => Promise<unknown>;
  onOpenPath: (path: string) => Promise<unknown>;
  publishCommand: string | null;
}

export function AppShell(props: AppShellProps) {
  const [activeView, setActiveView] = useState<AppShellView>('home');

  if (props.workspaceState === undefined) {
    return <ShellLoading />;
  }

  if (props.workspaceState === null) {
    return (
      <FirstRunShell
        onSelectWorkspace={props.onSelectWorkspace}
        busyAction={props.busyAction}
        errorMessage={props.errorMessage}
      />
    );
  }

  return (
    <div className="pac-shell">
      <Sidebar
        activeView={activeView}
        onNavigate={setActiveView}
        snapshotId={props.selectedSnapshotId}
        workspaceRoot={props.workspaceState.workspaceRoot}
        onSelectWorkspace={props.onSelectWorkspace}
      />
      <main className="pac-main">
        <TopBar
          title={titleFor(activeView)}
          subtitle={subtitleFor(activeView)}
          snapshotId={props.selectedSnapshotId}
          statusMessage={props.statusMessage}
          errorMessage={props.errorMessage}
          busyAction={props.busyAction}
          onRefresh={props.onRefresh}
        />
        <div className="pac-content">
          {activeView === 'home' ? <HomeView {...props} onNavigate={setActiveView} /> : null}
          {activeView === 'coverage' ? (
            <CoverageExplorerPanel
              snapshotId={props.selectedSnapshotId}
              summary={props.coverageSummary}
              listing={props.coverageListing}
              detail={props.coverageDetail}
              selectedProblemId={props.selectedCoverageProblemId}
              filters={props.coverageFilters}
              previewUrl={props.previewUrl}
              onFiltersChange={props.onCoverageFiltersChange}
              onSelectProblem={props.onSelectCoverageProblem}
              onOpenPath={props.onOpenPath}
              onOpenExternal={props.onOpenExternal}
            />
          ) : null}
          {activeView === 'browse' ? (
            <InlineBrowseViewer
              previewUrl={props.previewUrl}
              onOpenExternal={props.onOpenExternal}
            />
          ) : null}
          {activeView === 'data' ? (
            <DataExplorerPanel
              snapshotId={props.selectedSnapshotId}
              normalizedRoot={props.archiveSummary?.normalizedRoot}
              mirrorRoot={props.archiveSummary?.mirrorRoot}
              mirrorServeCommand={props.archiveSummary?.mirrorServeCommand}
              mirrorUrl={props.archiveSummary?.mirrorUrl}
              datasetSummaries={props.archiveSummary?.datasets ?? []}
              selectedDataset={props.selectedArchiveDataset}
              selectedRecordId={props.selectedArchiveRecordId}
              archiveQuery={props.archiveQuery}
              listing={props.archiveListing}
              detail={props.archiveRecordDetail}
              previewUrl={props.previewUrl}
              onDatasetChange={props.onArchiveDatasetChange}
              onArchiveQueryChange={props.onArchiveQueryChange}
              onSelectRecord={props.onSelectArchiveRecord}
              onOpenPath={props.onOpenPath}
              onOpenExternal={props.onOpenExternal}
            />
          ) : null}
          {activeView === 'settings' ? <SettingsView {...props} /> : null}
        </div>
      </main>
    </div>
  );
}

function Sidebar({
  activeView,
  onNavigate,
  snapshotId,
  workspaceRoot,
  onSelectWorkspace,
}: {
  activeView: AppShellView;
  onNavigate: (view: AppShellView) => void;
  snapshotId: string;
  workspaceRoot: string;
  onSelectWorkspace: (workspaceRoot: string) => Promise<unknown>;
}) {
  const items: Array<{ id: AppShellView; icon: string; label: string; hint: string }> = [
    { id: 'home', icon: '▦', label: 'Home', hint: 'Dashboard at a glance' },
    { id: 'coverage', icon: '❂', label: 'Coverage', hint: 'Search and audit problems' },
    { id: 'browse', icon: '◉', label: 'Browse', hint: 'Live-site viewer' },
    { id: 'data', icon: '≡', label: 'Data', hint: 'Raw normalized archive' },
    { id: 'settings', icon: '✎', label: 'Settings', hint: 'Workspace and auth' },
  ];
  return (
    <aside className="pac-sidebar" aria-label="Primary navigation">
      <div className="pac-sidebar-brand">
        <strong>Problem Archive Crawler</strong>
        <span className="pac-sidebar-brand-sub">pbinfo archive console</span>
      </div>
      <nav className="pac-sidebar-nav view-switcher" role="tablist">
        {items.map((item) => (
          <button
            key={item.id}
            className={`pac-nav-button ${activeView === item.id ? 'pac-nav-button-active' : ''}`}
            role="tab"
            aria-selected={activeView === item.id}
            aria-label={item.label}
            onClick={() => onNavigate(item.id)}
            type="button"
          >
            <span className="pac-nav-icon" aria-hidden>{item.icon}</span>
            <span className="pac-nav-label">
              <strong>{item.label}</strong>
              <em>{item.hint}</em>
            </span>
          </button>
        ))}
      </nav>
      <div className="pac-sidebar-footer">
        <div className="pac-sidebar-footer-row">
          <span className="pac-sidebar-footer-label">Snapshot</span>
          <code className="pac-sidebar-footer-value">{snapshotId || '—'}</code>
        </div>
        <div className="pac-sidebar-footer-row pac-sidebar-footer-workspace">
          <span className="pac-sidebar-footer-label">Workspace</span>
          <code className="pac-sidebar-footer-value pac-sidebar-footer-wrap" title={workspaceRoot}>
            {workspaceRoot || '—'}
          </code>
        </div>
        <button
          type="button"
          className="pac-btn pac-btn-block"
          aria-label="Change workspace"
          onClick={() => {
            const input = typeof window !== 'undefined'
              ? window.prompt('Switch to workspace root:', workspaceRoot ?? '')
              : null;
            if (input && input.trim() && input.trim() !== workspaceRoot) {
              void onSelectWorkspace(input.trim());
            }
          }}
        >
          Change workspace…
        </button>
      </div>
    </aside>
  );
}

function TopBar({
  title,
  subtitle,
  snapshotId,
  statusMessage,
  errorMessage,
  busyAction,
  onRefresh,
}: {
  title: string;
  subtitle: string;
  snapshotId: string;
  statusMessage: string | null;
  errorMessage: string | null;
  busyAction: string | null;
  onRefresh: () => Promise<unknown>;
}) {
  return (
    <header className="pac-topbar">
      <div className="pac-topbar-main">
        <h1 className="pac-topbar-title">{title}</h1>
        <p className="pac-topbar-subtitle">{subtitle}</p>
      </div>
      <div className="pac-topbar-right">
        {busyAction ? <span className="pac-topbar-busy">Working on <code>{busyAction}</code>…</span> : null}
        {statusMessage ? <span className="pac-topbar-ok">{statusMessage}</span> : null}
        {errorMessage ? <span className="pac-topbar-err">{errorMessage}</span> : null}
        <span className="pac-topbar-snapshot" title="Active snapshot">{snapshotId || '—'}</span>
        <button className="pac-btn pac-btn-ghost" type="button" onClick={() => void onRefresh()}>
          Refresh
        </button>
      </div>
    </header>
  );
}

function HomeView(props: AppShellProps & { onNavigate: (view: AppShellView) => void }) {
  const total = props.coverageSummary?.totalProblems ?? 0;
  const solved = props.coverageSummary?.solvedByMeCount ?? 0;
  const complete = props.coverageSummary?.completeProblemCount ?? 0;
  const testsArchived = props.coverageSummary?.testsFragmentArchivedCount ?? 0;
  const editorialsVisible = props.coverageSummary?.editorialVisibleCount ?? 0;
  const userSources = props.coverageSummary?.problemsWithUserSourceArchived ?? 0;
  const officialSources = props.coverageSummary?.problemsWithOfficialSourceArchived ?? 0;

  const archivedPct = useMemo(() => {
    if (!total) return 0;
    return Math.round((complete / total) * 100);
  }, [complete, total]);

  const solvedPct = useMemo(() => {
    if (!total) return 0;
    return Math.round((solved / total) * 100);
  }, [solved, total]);

  const recentJobs = useMemo(() => [...props.jobs].reverse().slice(0, 4), [props.jobs]);

  return (
    <div className="pac-home">
      <section className="pac-home-hero">
        <div className="pac-home-hero-copy">
          <p className="pac-kicker">Archive health</p>
          <h2>{archivedPct}% complete</h2>
          <p className="pac-home-hero-sub">
            {complete.toLocaleString()} of {total.toLocaleString()} problems have every archive piece they need
            (statement, editorial, official source when upstream, your 100-pt source, tests).
          </p>
        </div>
        <div className="pac-home-hero-chart" role="img" aria-label={`${archivedPct} percent archive complete`}>
          <ProgressRing value={archivedPct} label={`${archivedPct}%`} />
        </div>
      </section>

      <section className="pac-home-stats">
        <StatTile label="Solved" value={solved} hint={`${solvedPct}% of archive`} tone="success" />
        <StatTile label="Tests archived" value={testsArchived} hint="With at least one test fragment" tone="neutral" />
        <StatTile label="Editorials visible" value={editorialsVisible} hint="Indicații de rezolvare captured" tone="neutral" />
        <StatTile label="Your sources" value={userSources} hint="Per-language 100-pt" tone="success" />
        <StatTile label="Official sources" value={officialSources} hint="Exposed upstream" tone="warning" />
      </section>

      <section className="pac-home-grid">
        <article className="pac-card pac-card-actions">
          <h3>Quick actions</h3>
          <p className="pac-muted">Keep the archive current or jump into the audit.</p>
          <div className="pac-action-grid">
            <button className="pac-btn pac-btn-primary" type="button" onClick={() => props.onNavigate('coverage')}>
              Open coverage
            </button>
            <button className="pac-btn" type="button" onClick={() => props.onNavigate('browse')}>
              Live-site viewer
            </button>
            <button
              className="pac-btn"
              type="button"
              onClick={() => void props.onStartCrawl('all')}
              disabled={Boolean(props.busyAction)}
            >
              Continue crawl
            </button>
            <button
              className="pac-btn"
              type="button"
              onClick={() => void props.onStartMirrorPreview()}
              disabled={Boolean(props.previewUrl)}
            >
              {props.previewUrl ? 'Mirror running' : 'Start mirror preview'}
            </button>
          </div>
        </article>

        <article className="pac-card pac-card-crawl">
          <h3>Crawl status</h3>
          {props.crawlStatus ? (
            <div className="pac-crawl-grid">
              <div>
                <span className="pac-muted">Pending</span>
                <strong>{props.crawlStatus.pending.toLocaleString()}</strong>
              </div>
              <div>
                <span className="pac-muted">Completed</span>
                <strong>{props.crawlStatus.completed.toLocaleString()}</strong>
              </div>
              <div>
                <span className="pac-muted">In progress</span>
                <strong>{props.crawlStatus.inProgress.toLocaleString()}</strong>
              </div>
              <div>
                <span className="pac-muted">Publish eligible</span>
                <strong>{props.crawlStatus.publishEligible ? 'Yes' : 'No'}</strong>
              </div>
            </div>
          ) : (
            <p className="pac-muted">Crawl status will appear once the selected snapshot exists.</p>
          )}
        </article>

        <article className="pac-card pac-card-jobs">
          <h3>Recent jobs</h3>
          {recentJobs.length === 0 ? (
            <p className="pac-muted">No jobs yet. Run a crawl or mirror preview to see entries here.</p>
          ) : (
            <ul className="pac-jobs-list">
              {recentJobs.map((job) => (
                <li key={job.jobId}>
                  <span className={`pac-badge pac-badge-${statusTone(job.status)}`}>{job.status}</span>
                  <strong>{job.kind}</strong>
                  <em className="pac-muted">{job.snapshotId ?? '—'}</em>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>
    </div>
  );
}

function SettingsView(props: AppShellProps) {
  const [profileLabel, setProfileLabel] = useState<string>('Prekzursil');
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const profiles = props.workspaceState?.profiles ?? [];
  const activeProfileId = props.workspaceState?.activeProfileId;

  return (
    <div className="pac-settings">
      <section className="pac-card">
        <h3>Workspace</h3>
        <p className="pac-muted">Everything below is scoped to this workspace root.</p>
        <code className="pac-settings-path">{props.workspaceState?.workspaceRoot ?? '—'}</code>
        <div className="pac-action-grid">
          <button className="pac-btn" type="button" onClick={() => void props.onRefresh()}>Reload state</button>
          <button
            className="pac-btn"
            type="button"
            onClick={() => void props.onSelectWorkspace(props.workspaceState?.workspaceRoot ?? process.cwd())}
          >
            Re-select workspace
          </button>
        </div>
      </section>

      <section className="pac-card">
        <h3>PBInfo login</h3>
        <p className="pac-muted">
          Credentials live in <code>.local/pbinfo.local.json</code> (gitignored). Once a login succeeds,
          session cookies are stored in <code>.local/pbinfo-session.json</code> and can be sealed into
          <code> archive/secrets/*.age</code>.
        </p>
        <div className="pac-settings-form">
          <label>
            <span>Profile label</span>
            <input value={profileLabel} onChange={(event) => setProfileLabel(event.target.value)} />
          </label>
          <label>
            <span>Username</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label>
            <span>Password</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button
            type="button"
            className="pac-btn pac-btn-primary"
            disabled={!profileLabel || !username || !password || Boolean(props.busyAction)}
            onClick={() =>
              void props.onLoginProfile({
                profileId: profileLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                label: profileLabel,
                userHandle: username,
                username,
                password,
              })
            }
          >
            Log in + persist cookies
          </button>
        </div>
      </section>

      {profiles.length > 0 ? (
        <section className="pac-card">
          <h3>Archived profiles</h3>
          <ul className="pac-profile-list">
            {profiles.map((profile) => (
              <li key={profile.profileId}>
                <div>
                  <strong>{profile.label}</strong>
                  <em className="pac-muted">{profile.userHandle ?? profile.profileId}</em>
                </div>
                <div className="pac-action-grid">
                  {profile.profileId === activeProfileId ? (
                    <span className="pac-badge pac-badge-success">Active</span>
                  ) : (
                    <button
                      type="button"
                      className="pac-btn"
                      onClick={() => void props.onActivateProfile(profile.profileId)}
                    >
                      Activate
                    </button>
                  )}
                  <button
                    type="button"
                    className="pac-btn pac-btn-danger"
                    onClick={() => void props.onDeleteProfile(profile.profileId)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="pac-card">
        <h3>Snapshot workflow</h3>
        <p className="pac-muted">Run the post-crawl pipeline or publish the current snapshot.</p>
        <div className="pac-action-grid">
          <button type="button" className="pac-btn" onClick={() => void props.onRunSnapshotJob('normalize')}>Normalize</button>
          <button type="button" className="pac-btn" onClick={() => void props.onRunSnapshotJob('rank')}>Rank</button>
          <button type="button" className="pac-btn" onClick={() => void props.onRunSnapshotJob('mirror-build')}>Build mirror</button>
          <button type="button" className="pac-btn" onClick={() => void props.onRunSnapshotJob('snapshot-finalize')}>Finalize</button>
        </div>
        {props.publishCommand ? (
          <div className="pac-settings-publish">
            <span className="pac-muted">Publish command</span>
            <code>{props.publishCommand}</code>
          </div>
        ) : null}
      </section>

      <section className="pac-card">
        <h3>Verbosity</h3>
        <p className="pac-muted">How much crawler chatter the Home dashboard should show.</p>
        <select
          value={props.verbosityMode}
          onChange={(event) => props.onVerbosityChange(event.target.value as GuiVerbosityMode)}
        >
          <option value="normal">Normal</option>
          <option value="verbose">Verbose</option>
          <option value="raw">Raw event stream</option>
        </select>
      </section>
    </div>
  );
}

function FirstRunShell({
  onSelectWorkspace,
  busyAction,
  errorMessage,
}: {
  onSelectWorkspace: (workspaceRoot: string) => Promise<unknown>;
  busyAction: string | null;
  errorMessage: string | null;
}) {
  const [workspaceRoot, setWorkspaceRoot] = useState<string>('');
  return (
    <div className="pac-first-run">
      <form
        className="pac-first-run-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (!workspaceRoot) {
            return;
          }
          void onSelectWorkspace(workspaceRoot);
        }}
      >
        <h1>Choose a workspace</h1>
        <p className="pac-muted">Pick the Problem Archive Crawler workspace to begin.</p>
        <label>
          <span>Workspace root</span>
          <input
            value={workspaceRoot}
            onChange={(event) => setWorkspaceRoot(event.target.value)}
            placeholder="C:\\Users\\you\\Documents\\GitHub\\pbinfo-scrape"
            aria-label="Workspace root"
          />
        </label>
        {errorMessage ? <p className="pac-error">{errorMessage}</p> : null}
        <button
          type="submit"
          className="pac-btn pac-btn-primary"
          disabled={!workspaceRoot || Boolean(busyAction)}
        >
          Open workspace
        </button>
      </form>
    </div>
  );
}

function ShellLoading() {
  return (
    <div className="pac-loading">
      <p>Loading…</p>
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone: 'success' | 'warning' | 'neutral';
}) {
  return (
    <div className={`pac-stat pac-stat-${tone}`}>
      <span className="pac-stat-label">{label}</span>
      <strong className="pac-stat-value">{value.toLocaleString()}</strong>
      <span className="pac-stat-hint">{hint}</span>
    </div>
  );
}

function ProgressRing({ value, label }: { value: number; label: string }): ReactNode {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, value));
  const dashOffset = circumference * (1 - pct / 100);
  return (
    <svg width={120} height={120} viewBox="0 0 120 120" role="presentation">
      <circle cx={60} cy={60} r={radius} className="pac-ring-track" />
      <circle
        cx={60}
        cy={60}
        r={radius}
        className="pac-ring-progress"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform="rotate(-90 60 60)"
      />
      <text x={60} y={65} textAnchor="middle" className="pac-ring-label">
        {label}
      </text>
    </svg>
  );
}

function statusTone(status: string): string {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
    case 'cancelled':
      return 'danger';
    case 'running':
    case 'paused':
      return 'warning';
    default:
      return 'neutral';
  }
}

function titleFor(view: AppShellView): string {
  switch (view) {
    case 'home':
      return 'Home';
    case 'coverage':
      return 'Problems';
    case 'browse':
      return 'Browse';
    case 'data':
      return 'Data';
    case 'settings':
      return 'Settings';
  }
}

function subtitleFor(view: AppShellView): string {
  switch (view) {
    case 'home':
      return 'Archive health at a glance.';
    case 'coverage':
      return 'Search, filter, and audit per problem.';
    case 'browse':
      return 'Open mirrored problem pages inside the app.';
    case 'data':
      return 'Raw normalized datasets and record payloads.';
    case 'settings':
      return 'Workspace, PBInfo login, and snapshot workflow.';
  }
}
