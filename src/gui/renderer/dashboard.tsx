import { type ReactNode, useEffect, useMemo, useState } from 'react';

import type { DesktopBridge } from '../shared/bridge.js';
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
  GuiJobCounters,
  GuiJobEvent,
  GuiJobRecord,
  GuiProfileRecord,
  GuiWorkspaceState,
} from '../shared/types.js';
import {
  CoverageExplorerPanel,
  type CoverageExplorerFilters,
} from './coverage-explorer.js';
import { DataExplorerPanel } from './data-explorer.js';

type CredentialLoginInput = Parameters<DesktopBridge['loginProfile']>[0];
type BrowserImportInput = Parameters<DesktopBridge['importBrowserProfile']>[0];
type VerbosityMode = 'normal' | 'verbose' | 'raw';
type CrawlMode = GuiCrawlMode;
type DashboardView = 'overview' | 'coverage' | 'data' | 'setup';

export interface DesktopDashboardProps {
  workspaceState: GuiWorkspaceState | null | undefined;
  jobs: GuiJobRecord[];
  crawlStatus: GuiCrawlStatus | null;
  jobEvents: GuiJobEvent[];
  selectedSnapshotId: string;
  selectedCrawlMode: CrawlMode;
  verbosityMode: VerbosityMode;
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
  busyAction: string | null;
  statusMessage: string | null;
  errorMessage: string | null;
  previewUrl?: string;
  previewJobId?: string;
  publishCommand: string | null;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
  onSnapshotChange: (snapshotId: string) => void;
  onCrawlModeChange: (crawlMode: CrawlMode) => void;
  onVerbosityChange: (verbosityMode: VerbosityMode) => void;
  onCoverageFiltersChange: (filters: CoverageExplorerFilters) => void;
  onSelectCoverageProblem: (problemId: number) => void;
  onArchiveDatasetChange: (dataset: GuiArchiveDataset) => void;
  onArchiveQueryChange: (query: string) => void;
  onSelectArchiveRecord: (recordId: string) => void;
  onSelectWorkspace: (workspaceRoot: string) => Promise<unknown>;
  onRefresh: () => Promise<unknown>;
  onLoginProfile: (input: CredentialLoginInput) => Promise<unknown>;
  onImportBrowserProfile: (input: BrowserImportInput) => Promise<unknown>;
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
  onOpenPath: (path: string) => Promise<unknown>;
  onOpenExternal: (url: string) => Promise<unknown>;
}

export function DesktopDashboard(props: DesktopDashboardProps) {
  const {
    workspaceState,
    jobs,
    crawlStatus,
    jobEvents,
    selectedSnapshotId,
    selectedCrawlMode,
    verbosityMode,
    archiveSummary,
    archiveListing,
    archiveRecordDetail,
    coverageSummary,
    coverageListing,
    coverageDetail,
    selectedCoverageProblemId,
    coverageFilters,
    selectedArchiveDataset,
    selectedArchiveRecordId,
    archiveQuery,
    busyAction,
    statusMessage,
    errorMessage,
    previewUrl,
    previewJobId,
    publishCommand,
    showAdvanced,
    onToggleAdvanced,
    onSnapshotChange,
    onCrawlModeChange,
    onVerbosityChange,
    onCoverageFiltersChange,
    onSelectCoverageProblem,
    onArchiveDatasetChange,
    onArchiveQueryChange,
    onSelectArchiveRecord,
    onSelectWorkspace,
    onRefresh,
    onLoginProfile,
    onImportBrowserProfile,
    onActivateProfile,
    onDeleteProfile,
    onStartCrawl,
    onPauseCrawl,
    onResumeCrawl,
    onRunSnapshotJob,
    onStartMirrorPreview,
    onStopMirrorPreview,
    onOpenPath,
    onOpenExternal,
  } = props;

  const [workspaceDraft, setWorkspaceDraft] = useState(workspaceState?.workspaceRoot ?? '');
  const [loginForm, setLoginForm] = useState<CredentialLoginInput>({
    profileId: 'primary-login',
    label: 'Primary account',
    userHandle: 'Prekzursil',
    username: '',
    password: '',
  });
  const [importForm, setImportForm] = useState<BrowserImportInput>({
    profileId: 'edge-default',
    label: 'Edge session',
    userHandle: 'Prekzursil',
    browser: 'edge',
    profileName: 'Default',
  });
  const [activeView, setActiveView] = useState<DashboardView>('overview');
  const [showEmbeddedPreview, setShowEmbeddedPreview] = useState(false);

  useEffect(() => {
    if (workspaceState?.workspaceRoot) {
      setWorkspaceDraft(workspaceState.workspaceRoot);
    }
  }, [workspaceState?.workspaceRoot]);

  const activeProfile = useMemo(() => getActiveProfile(workspaceState), [workspaceState]);
  const activeCrawlJob = useMemo(() => [...jobs].reverse().find((job) => job.kind === 'crawl'), [jobs]);
  const visibleLogEntries = useMemo(
    () => filterLogEntries(jobEvents.length > 0 ? jobEvents : buildLogEntries(jobs), verbosityMode),
    [jobEvents, jobs, verbosityMode],
  );
  const recentFailureCount = crawlStatus?.recentFailures.length ?? 0;
  const crawlTelemetry = useMemo(
    () => deriveCrawlTelemetry(crawlStatus ?? activeCrawlJob?.latestCounters, jobEvents),
    [activeCrawlJob?.latestCounters, crawlStatus, jobEvents],
  );

  if (workspaceState === undefined) {
    return <main className="desktop-shell"><section className="panel"><p>Loading desktop state…</p></section></main>;
  }

  return (
    <main className="desktop-shell desktop-shell-simplified">
      <section className="topbar-card panel">
        <div className="topbar-brand">
          <div className="brand-lockup brand-lockup-compact">
            <div className="brand-mark brand-mark-compact" aria-hidden="true">
              <span className="brand-mark-frame" />
              <span className="brand-mark-sheet brand-mark-sheet-back" />
              <span className="brand-mark-sheet brand-mark-sheet-front" />
              <span className="brand-mark-target" />
            </div>
            <div>
              <p className="eyebrow">Problem Archive Crawler</p>
              <h1>Problem Archive Crawler</h1>
              <p className="hero-subtitle">PBInfo archival operator console</p>
            </div>
          </div>
          <p className="lede lede-compact">
            A lighter control surface for continuing the crawl, checking coverage,
            and opening the local archive.
          </p>
        </div>
        <div className="topbar-status-grid">
          <SummaryCard label="Snapshot" value={selectedSnapshotId}>
            <p className="summary-copy">
              {crawlStatus?.publishEligible ? 'Drained and publish-ready.' : 'Current archive target.'}
            </p>
            {workspaceState?.workspaceRoot ? (
              <p className="summary-copy mono">{workspaceState.workspaceRoot}</p>
            ) : null}
          </SummaryCard>
          <SummaryCard label="Profile" value={activeProfile?.label ?? 'No active profile'}>
            <p className="summary-copy">
              {activeProfile?.userHandle ? `Handle ${activeProfile.userHandle}` : 'Use Setup to import or sign in.'}
            </p>
          </SummaryCard>
          <SummaryCard
            label="Queue"
            value={
              crawlStatus?.publishEligible
                ? 'Ready'
                : formatCounters(crawlStatus ?? activeCrawlJob?.latestCounters)
            }
          >
            <p className="summary-copy">
              {crawlStatus?.publishEligible
                ? 'The canonical snapshot is ready for review.'
                : `${recentFailureCount} recent failures tracked.`}
            </p>
          </SummaryCard>
          <div className="topbar-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => void onRefresh()}
              disabled={busyAction !== null}
            >
              Refresh
            </button>
          </div>
        </div>
      </section>

      <section className="view-switcher-card panel">
        <div className="view-switcher" aria-label="App sections">
          {renderViewButton('Overview', 'overview', activeView, setActiveView)}
          {renderViewButton('Coverage', 'coverage', activeView, setActiveView)}
          {renderViewButton('Data', 'data', activeView, setActiveView)}
          {renderViewButton('Setup', 'setup', activeView, setActiveView)}
        </div>
        <p className="summary-copy view-switcher-copy">{describeView(activeView)}</p>
      </section>

      <div className="hero-status-row">
        {statusMessage ? <p className="callout callout-success">{statusMessage}</p> : null}
        {errorMessage ? <p className="callout callout-error">{errorMessage}</p> : null}
      </div>

      {workspaceState === null ? (
        <section className="panel empty-state bootstrap-panel">
          <div className="panel-heading"><div><p className="section-kicker">Workspace bootstrap</p><h2>Choose a workspace</h2></div></div>
          <p className="summary-copy">Keep queues, logs, profiles, and snapshots in a portable workspace folder.</p>
          <form className="stack-form" onSubmit={(event) => { event.preventDefault(); void onSelectWorkspace(workspaceDraft); }}>
            <label className="field"><span>Workspace path</span><input value={workspaceDraft} onChange={(event) => setWorkspaceDraft(event.target.value)} placeholder="C:/pbinfo-workspace" /></label>
            <button className="primary-button" type="submit" disabled={!workspaceDraft}>Select workspace</button>
          </form>
        </section>
      ) : (
        <div className="dashboard-grid">
          {activeView === 'setup' ? (
            <section className="panel workspace-panel">
            <PanelHeading kicker="Workspace and identity" title="Workspace" chip={`${workspaceState.profiles.length} profiles`} />
            <div className="workspace-summary">
              <SummaryCard label="Workspace root"><p className="mono">{workspaceState.workspaceRoot}</p></SummaryCard>
              <SummaryCard label="Active profile" value={activeProfile?.label ?? 'No active profile'}>
                <p className="summary-copy">{activeProfile?.userHandle ? `Handle: ${activeProfile.userHandle}` : 'Create or import a PBInfo session profile to enable authenticated crawl work.'}</p>
              </SummaryCard>
              <SummaryCard label="Snapshot target">
                <input value={selectedSnapshotId} onChange={(event) => onSnapshotChange(event.target.value)} placeholder="acceptance-20260310b" />
                <p className="summary-copy">Canonical drain target and mirror build source.</p>
              </SummaryCard>
            </div>
            <div className="profile-list">
              {workspaceState.profiles.length === 0 ? <p className="summary-copy">No saved PBInfo profiles yet.</p> : workspaceState.profiles.map((profile) => (
                <article className="job-card profile-card" key={profile.profileId}>
                  <header>
                    <div><strong>{profile.label}</strong><p className="job-meta">{profile.profileId} • {formatProfileProvenance(profile)}</p></div>
                    {workspaceState.activeProfileId === profile.profileId ? <span className="status-badge status-completed">active</span> : null}
                  </header>
                  <p className="summary-copy">{profile.userHandle ? `Handle ${profile.userHandle}` : 'No user handle saved'}</p>
                  <div className="button-row">
                    <button className="ghost-button" type="button" onClick={() => void onActivateProfile(profile.profileId)}>Activate</button>
                    <button className="ghost-button ghost-danger" type="button" onClick={() => void onDeleteProfile(profile.profileId)}>Delete</button>
                  </div>
                </article>
              ))}
            </div>
            </section>
          ) : null}

          {activeView === 'setup' ? (
            <section className="panel action-panel">
            <PanelHeading kicker="Authentication lanes" title="Profiles & Access" />
            <div className="auth-grid">
              <form className="stack-form summary-card form-card" onSubmit={(event) => { event.preventDefault(); void onLoginProfile(loginForm); }}>
                <strong>Credential login</strong>
                <p className="summary-copy">Use direct account auth for a crawler-owned session.</p>
                <Field label="Profile id"><input value={loginForm.profileId} onChange={(event) => setLoginForm((current) => ({ ...current, profileId: event.target.value }))} /></Field>
                <Field label="Label"><input value={loginForm.label} onChange={(event) => setLoginForm((current) => ({ ...current, label: event.target.value }))} /></Field>
                <Field label="User handle"><input value={loginForm.userHandle ?? ''} onChange={(event) => setLoginForm((current) => ({ ...current, userHandle: event.target.value || undefined }))} /></Field>
                <Field label="Username"><input value={loginForm.username} onChange={(event) => setLoginForm((current) => ({ ...current, username: event.target.value }))} /></Field>
                <Field label="Password"><input type="password" value={loginForm.password} onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))} /></Field>
                <button className="primary-button" type="submit">Sign in</button>
              </form>

              <form className="stack-form summary-card form-card" onSubmit={(event) => { event.preventDefault(); void onImportBrowserProfile(importForm); }}>
                <strong>Browser import</strong>
                <p className="summary-copy">Reuse a verified local browser session when that is the fastest path.</p>
                <Field label="Profile id"><input value={importForm.profileId} onChange={(event) => setImportForm((current) => ({ ...current, profileId: event.target.value }))} /></Field>
                <Field label="Label"><input value={importForm.label} onChange={(event) => setImportForm((current) => ({ ...current, label: event.target.value }))} /></Field>
                <Field label="Browser">
                  <select value={importForm.browser} onChange={(event) => setImportForm((current) => ({ ...current, browser: event.target.value as BrowserImportInput['browser'] }))}>
                    <option value="edge">Edge</option><option value="chrome">Chrome</option>
                  </select>
                </Field>
                <Field label="Browser profile"><input value={importForm.profileName ?? ''} onChange={(event) => setImportForm((current) => ({ ...current, profileName: event.target.value || undefined }))} /></Field>
                <Field label="User handle"><input value={importForm.userHandle ?? ''} onChange={(event) => setImportForm((current) => ({ ...current, userHandle: event.target.value || undefined }))} /></Field>
                <button className="primary-button" type="submit">Import browser cookies</button>
              </form>
            </div>
            </section>
          ) : null}

          {activeView === 'overview' ? (
            <section className="panel snapshot-panel">
            <PanelHeading kicker="Archive health" title="Archive Overview" chip={selectedSnapshotId} />
            {crawlStatus ? (
              <div className="snapshot-grid">
                <SummaryCard label="Queue counts" value={`${crawlStatus.pending} pending`}>
                  <p className="summary-copy">{`${crawlStatus.completed} completed • ${crawlStatus.inProgress} in progress`}</p>
                </SummaryCard>
                <SummaryCard label="Publish readiness" value={crawlStatus.publishEligible ? 'Ready' : 'Not ready'}>
                  <p className="summary-copy">{crawlStatus.publishEligible ? 'The canonical snapshot is drained and can be published through the guarded CLI.' : `${recentFailureCount} recent failures recorded.`}</p>
                </SummaryCard>
                <SummaryCard label="Real-time ETA" value={crawlTelemetry ? formatEta(crawlTelemetry.etaSeconds) : 'Learning…'}>
                  <p className="summary-copy">
                    {crawlTelemetry
                      ? `${formatRate(crawlTelemetry.completedPerMinute)} completed/min across recent crawl chunks.`
                      : 'ETA appears after enough crawl history accumulates for a stable projection.'}
                  </p>
                </SummaryCard>
                <SummaryCard label="Queue DB"><p className="mono">{crawlStatus.queuePath}</p></SummaryCard>
              </div>
            ) : <p className="summary-copy">Crawl status will appear here after the selected snapshot exists.</p>}
            {publishCommand ? <article className="summary-card publish-card"><span className="metric-label">Ready to publish</span><p className="mono">{publishCommand}</p></article> : null}
            </section>
          ) : null}

          {activeView === 'overview' ? (
            <section className="panel jobs-panel">
            <PanelHeading kicker="Quick actions" title="What happens next" chip={`${jobs.length} jobs`} />
            <div className="summary-card form-card">
              <Field label="Crawl mode">
                <select
                  aria-label="Crawl mode"
                  value={selectedCrawlMode}
                  onChange={(event) => onCrawlModeChange(event.target.value as CrawlMode)}
                >
                  <option value="incremental">Incremental sync</option>
                  <option value="fresh">Fresh recrawl</option>
                </select>
              </Field>
              <p className="summary-copy">
                Incremental sync reuses the canonical archive and skips completed URLs. Fresh recrawl creates a new snapshot from scratch.
              </p>
            </div>
            <div className="action-grid">
              <ActionButton title="Start public crawl" copy="Seed and continue the public PBInfo queue." primary onClick={() => void onStartCrawl('public')} />
              <ActionButton title="Start user crawl" copy="Harvest authenticated profile, solution, and evaluation pages." primary onClick={() => void onStartCrawl('user')} />
              <ActionButton title="Start full crawl" copy="Drive the canonical same-host drain target." primary onClick={() => void onStartCrawl('all')} />
              <ActionButton title="Normalize snapshot" copy="Rebuild normalized records without re-fetching." onClick={() => void onRunSnapshotJob('normalize')} />
              <ActionButton title="Rank sources" copy="Refresh user and official best-per-language outputs." onClick={() => void onRunSnapshotJob('rank')} />
              <ActionButton title="Build mirror" copy="Rebuild localhost routes and local asset rewrites." onClick={() => void onRunSnapshotJob('mirror-build')} />
              <ActionButton title="Finalize snapshot" copy="Normalize, rank, mirror, export, and prune noncanonical state." onClick={() => void onRunSnapshotJob('snapshot-finalize')} />
            </div>
            <div className="button-row">
              <button className="ghost-button" type="button" onClick={() => setActiveView('coverage')}>Open coverage</button>
              <button className="ghost-button" type="button" onClick={() => setActiveView('data')}>Open raw data</button>
            </div>
            {activeCrawlJob ? <div className="button-row"><button className="ghost-button" type="button" onClick={() => void onResumeCrawl(activeCrawlJob.jobId)}>Resume crawl</button><button className="ghost-button ghost-danger" type="button" onClick={() => void onPauseCrawl(activeCrawlJob.jobId)}>Pause after current chunk completes</button></div> : null}
            <div className="job-list">
              {jobs.length === 0 ? <p className="summary-copy">No desktop jobs recorded yet.</p> : jobs.map((job) => (
                <article className="job-card" key={job.jobId}>
                  <header><div><strong>{job.snapshotId ?? job.kind}</strong><p className="job-meta">{formatJobMeta(job)}</p></div><span className={`status-badge status-${job.status}`}>{job.status}</span></header>
                  <p>{formatJobSummary(job)}</p>
                  {job.latestEvent?.message ? <p className="job-event">{job.latestEvent.message}</p> : null}
                </article>
              ))}
            </div>
            </section>
          ) : null}

          {activeView === 'overview' ? (
            <section className="panel logs-panel">
            <div className="panel-heading">
              <div><p className="section-kicker">Structured events</p><h2>Recent activity</h2></div>
              <div className="panel-actions">
                <div className="segmented-control" role="group" aria-label="Verbosity">
                  {(['normal', 'verbose', 'raw'] as const).map((mode) => <button key={mode} className={`segmented-button ${verbosityMode === mode ? 'segmented-button-active' : ''}`} type="button" aria-pressed={verbosityMode === mode} onClick={() => onVerbosityChange(mode)}>{capitalize(mode)}</button>)}
                </div>
                <span className="panel-chip">{visibleLogEntries.length} visible</span>
              </div>
            </div>
            <p className="summary-copy log-summary">{verbosityMode === 'normal' ? 'Normal shows the recent operator-facing stream only.' : verbosityMode === 'verbose' ? 'Verbose expands counters and structured detail for each event.' : 'Raw exposes the unfiltered event payloads exactly as captured.'}</p>
            {visibleLogEntries.length === 0 ? <p className="summary-copy">Structured job events will appear here during long-running work.</p> : (
              <div className="log-list">
                {visibleLogEntries.map((entry, index) => (
                  <article className={`log-card log-${entry.level}`} key={`${entry.timestamp}-${index}`}>
                    <header><span className="log-stage">{entry.stage}</span><time dateTime={entry.timestamp}>{formatTimestamp(entry.timestamp)}</time></header>
                    <p>{entry.message}</p>
                    {verbosityMode !== 'normal' && entry.counters ? <p className="log-counters">{formatCounters(entry.counters)}</p> : null}
                    {verbosityMode === 'verbose' && entry.detail ? <pre className="log-inline-detail">{JSON.stringify(entry.detail, null, 2)}</pre> : null}
                    {verbosityMode === 'raw' ? <pre className="log-inline-detail">{JSON.stringify(entry, null, 2)}</pre> : null}
                  </article>
                ))}
              </div>
            )}
            </section>
          ) : null}

          {activeView === 'overview' ? (
            <section className="panel mirror-panel">
            <PanelHeading kicker="Local snapshot" title="Mirror access" chip={previewUrl ? 'Preview live' : undefined} />
            <div className="mirror-stage">
              <div className="mirror-toolbar">
                <div className="button-row mirror-button-row">
                  <button className="ghost-button" type="button" onClick={() => void onStartMirrorPreview()}>Start preview</button>
                  <button className="ghost-button" type="button" disabled={!previewJobId} onClick={() => { if (previewJobId) { void onStopMirrorPreview(previewJobId); } }}>Stop preview</button>
                  <button className="ghost-button" type="button" disabled={!previewUrl} onClick={() => { if (previewUrl) { void onOpenExternal(previewUrl); } }}>Open in browser</button>
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={!previewUrl}
                    onClick={() => setShowEmbeddedPreview((current) => !current)}
                  >
                    {showEmbeddedPreview ? 'Hide embedded preview' : 'Show embedded preview'}
                  </button>
                </div>
                <article className="summary-card mirror-meta-card"><span className="metric-label">Mirror route</span><p className="mono mirror-address">{previewUrl ?? 'Not running'}</p></article>
              </div>
              {previewUrl && showEmbeddedPreview ? (
                <div className="mirror-frame-shell">
                  <iframe className="mirror-frame" src={previewUrl} title="Mirror preview" />
                </div>
              ) : (
                <div className="mirror-placeholder">
                  <strong>{previewUrl ? 'Embedded preview hidden' : 'No mirror preview running'}</strong>
                  <p>
                    {previewUrl
                      ? 'Keep the shell lightweight and open the embedded preview only when you need to inspect the full mirror in-place.'
                      : 'Start the mirror preview after building the selected snapshot to embed the localhost viewer here.'}
                  </p>
                </div>
              )}
            </div>
            </section>
          ) : null}

          {activeView === 'coverage' ? (
            <CoverageExplorerPanel
            snapshotId={selectedSnapshotId}
            summary={coverageSummary}
            listing={coverageListing}
            detail={coverageDetail}
            selectedProblemId={selectedCoverageProblemId}
            filters={coverageFilters}
            previewUrl={previewUrl}
            onFiltersChange={onCoverageFiltersChange}
            onSelectProblem={onSelectCoverageProblem}
            onOpenPath={onOpenPath}
            onOpenExternal={onOpenExternal}
            />
          ) : null}

          {activeView === 'data' ? (
            <DataExplorerPanel
            snapshotId={selectedSnapshotId}
            normalizedRoot={archiveSummary?.normalizedRoot}
            mirrorRoot={archiveSummary?.mirrorRoot}
            mirrorServeCommand={archiveSummary?.mirrorServeCommand}
            mirrorUrl={archiveSummary?.mirrorUrl}
            datasetSummaries={archiveSummary?.datasets ?? []}
            selectedDataset={selectedArchiveDataset}
            selectedRecordId={selectedArchiveRecordId}
            archiveQuery={archiveQuery}
            listing={archiveListing}
            detail={archiveRecordDetail}
            previewUrl={previewUrl}
            onDatasetChange={onArchiveDatasetChange}
            onArchiveQueryChange={onArchiveQueryChange}
            onSelectRecord={onSelectArchiveRecord}
            onOpenPath={onOpenPath}
            onOpenExternal={onOpenExternal}
            />
          ) : null}

          {activeView === 'setup' ? (
            <section className="panel setup-panel-toggle">
              <div className="button-row">
                <button className="ghost-button" type="button" onClick={onToggleAdvanced}>
                  {showAdvanced ? 'Hide advanced settings' : 'Advanced Settings'}
                </button>
              </div>
            </section>
          ) : null}

          {activeView === 'setup' && showAdvanced ? (
            <section className="panel advanced-panel">
              <PanelHeading kicker="Operator defaults" title="Advanced Settings" chip="Read-only diagnostics" />
              <div className="advanced-grid">
                <SummaryCard label="Desktop banners" value={workspaceState.notifications.desktopBanners ? 'Enabled' : 'Disabled'} />
                <SummaryCard label="Windows toast" value={workspaceState.notifications.windowsToast ? 'Enabled' : 'Disabled'} />
                <SummaryCard label="Recent failures" value={String(recentFailureCount)}>
                  <p className="summary-copy">{crawlStatus?.recentFailures[0]?.lastError ?? 'No recent crawl failures.'}</p>
                </SummaryCard>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </main>
  );
}

function PanelHeading({ kicker, title, chip }: { kicker: string; title: string; chip?: string }) {
  return <div className="panel-heading"><div><p className="section-kicker">{kicker}</p><h2>{title}</h2></div>{chip ? <span className="panel-chip">{chip}</span> : null}</div>;
}

function SummaryCard({ label, value, children }: { label: string; value?: string; children?: ReactNode }) {
  return <article className="summary-card"><span className="metric-label">{label}</span>{value ? <strong>{value}</strong> : null}{children}</article>;
}

function ActionButton({ title, copy, primary, onClick }: { title: string; copy: string; primary?: boolean; onClick: () => void }) {
  return <button className={`action-card ${primary ? 'action-primary' : ''}`} type="button" onClick={onClick}><strong>{title}</strong><span>{copy}</span></button>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function getActiveProfile(workspaceState: GuiWorkspaceState | null | undefined): GuiProfileRecord | undefined {
  return workspaceState?.profiles.find((profile) => profile.profileId === workspaceState.activeProfileId);
}

function buildLogEntries(jobs: GuiJobRecord[]): GuiJobEvent[] {
  return jobs.filter((job) => job.latestEvent).map((job) => job.latestEvent!).sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

function filterLogEntries(entries: GuiJobEvent[], verbosityMode: VerbosityMode): GuiJobEvent[] {
  const sorted = [...entries].sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  if (verbosityMode === 'raw') {
    return sorted.slice(0, 20);
  }
  const nonDebug = sorted.filter((entry) => entry.level !== 'debug');
  return verbosityMode === 'verbose' ? nonDebug.slice(0, 14) : nonDebug.slice(0, 8);
}

function formatProfileProvenance(profile: GuiProfileRecord): string {
  switch (profile.provenance.type) {
    case 'browser-import':
      return `Browser import (${profile.provenance.browser})`;
    case 'cookie-import':
      return 'Cookie import';
    case 'login':
      return 'Credential login';
  }
}

function formatJobMeta(job: GuiJobRecord): string {
  return job.profileId ? `${job.kind} • ${job.profileId}` : job.kind;
}

function formatJobSummary(job: GuiJobRecord): string {
  return formatCounters(job.latestCounters) || job.kind;
}

function formatCounters(counters: GuiJobCounters | { pending: number; completed: number; inProgress: number } | undefined): string {
  if (!counters) {
    return 'No queue counters yet';
  }
  const numberFormat = new Intl.NumberFormat('en-US');
  return `${numberFormat.format(counters.pending)} pending, ${numberFormat.format(counters.completed)} completed, ${numberFormat.format(counters.inProgress)} in progress`;
}

function deriveCrawlTelemetry(
  counters: GuiJobCounters | { pending: number; completed: number; inProgress: number } | null | undefined,
  jobEvents: GuiJobEvent[],
): { completedPerMinute: number; etaSeconds: number } | null {
  if (!counters || counters.pending <= 0) {
    return null;
  }

  const relevantEvents = [...jobEvents]
    .filter(
      (event) =>
        (event.stage === 'crawl' || event.stage === 'crawl-stalled') &&
        event.counters,
    )
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  if (relevantEvents.length < 2) {
    return null;
  }

  const latest = relevantEvents.at(-1);
  const latestCounters = latest?.counters;
  if (!latest || !latestCounters) {
    return null;
  }

  const baseline = [...relevantEvents]
    .reverse()
    .find(
      (event) =>
        event !== latest &&
        event.counters &&
        event.counters.completed < latestCounters.completed,
    );
  if (!baseline?.counters) {
    return null;
  }

  const elapsedSeconds =
    (new Date(latest.timestamp).getTime() - new Date(baseline.timestamp).getTime()) /
    1_000;
  const completedDelta = latestCounters.completed - baseline.counters.completed;
  if (elapsedSeconds <= 0 || completedDelta <= 0) {
    return null;
  }

  const completedPerMinute = completedDelta / (elapsedSeconds / 60);
  if (!Number.isFinite(completedPerMinute) || completedPerMinute <= 0) {
    return null;
  }

  return {
    completedPerMinute,
    etaSeconds: counters.pending / (completedPerMinute / 60),
  };
}

function formatRate(completedPerMinute: number): string {
  return `${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(completedPerMinute)}`;
}

function formatEta(etaSeconds: number): string {
  if (!Number.isFinite(etaSeconds) || etaSeconds <= 0) {
    return '<1m remaining';
  }

  const roundedMinutes = Math.max(1, Math.round(etaSeconds / 60));
  if (roundedMinutes < 60) {
    return `${roundedMinutes}m remaining`;
  }

  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  return minutes === 0
    ? `${hours}h remaining`
    : `${hours}h ${minutes}m remaining`;
}

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function renderViewButton(
  label: string,
  view: DashboardView,
  activeView: DashboardView,
  setActiveView: (view: DashboardView) => void,
) {
  const active = activeView === view;
  return (
    <button
      key={view}
      className={`view-switcher-button ${active ? 'view-switcher-button-active' : ''}`}
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => setActiveView(view)}
    >
      {label}
    </button>
  );
}

function describeView(activeView: DashboardView): string {
  switch (activeView) {
    case 'overview':
      return 'See the current archive target, quick actions, recent activity, and mirror access in one lightweight overview.';
    case 'coverage':
      return 'Audit which problems are solved, which have tests archived, and which still need source or editorial coverage.';
    case 'data':
      return 'Inspect the raw normalized datasets and jump directly to files or live mirror routes when needed.';
    case 'setup':
      return 'Keep workspace, profiles, login/import, and advanced operator defaults out of the main day-to-day surface.';
  }
}
