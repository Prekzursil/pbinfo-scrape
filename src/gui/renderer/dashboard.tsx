import { type Dispatch, type ReactNode, type SetStateAction, useMemo, useState } from 'react';

import type { DesktopBridge } from '../shared/bridge.js';
import type {
  GuiArchiveDataset,
  GuiArchiveListing,
  GuiArchiveRecordDetail,
  GuiArchiveSummary,
  GuiCoverageDetail,
  GuiCoverageListing,
  GuiCoverageRecord,
  GuiCoverageSummary,
  GuiCrawlMode,
  GuiCrawlStatus,
  GuiJobCounters,
  GuiJobEvent,
  GuiJobRecord,
  GuiProfileRecord,
  GuiWorkspaceState,
} from '../shared/types.js';
import { CoverageExplorerPanel, type CoverageExplorerFilters } from './coverage-explorer.js';
import { DataExplorerPanel } from './data-explorer.js';

type CredentialLoginInput = Parameters<DesktopBridge['loginProfile']>[0];
type BrowserImportInput = Parameters<DesktopBridge['importBrowserProfile']>[0];
type VerbosityMode = 'normal' | 'verbose' | 'raw';
type CrawlMode = GuiCrawlMode;
type DashboardView = 'overview' | 'coverage' | 'data' | 'setup';
type OverviewBoardPreset =
  | 'all'
  | 'solved'
  | 'unsolved'
  | 'complete'
  | 'missing-official-source'
  | 'missing-user-source'
  | 'missing-tests';

const DEFAULT_COVERAGE_FILTERS: CoverageExplorerFilters = {
  query: '',
  solved: 'all',
  testsFragmentArchived: 'all',
  visibleTestsCaptured: 'all',
  testsCoverageStatus: 'all',
  officialSourceArchived: 'all',
  userSourceArchived: 'all',
  editorialAvailability: 'all',
  archiveCompletenessStatus: 'all',
};

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

function countRecentFailures(crawlStatus: GuiCrawlStatus | null): number {
  return crawlStatus?.recentFailures.length ?? 0;
}

function shouldSyncWorkspaceDraft(
  workspaceState: GuiWorkspaceState | null | undefined,
  syncedWorkspaceRoot: string | undefined,
): boolean {
  const root = workspaceState?.workspaceRoot;
  return Boolean(root) && root !== syncedWorkspaceRoot;
}

function DashboardHeroStatusRow(props: {
  statusMessage?: string | null;
  errorMessage?: string | null;
}) {
  return (
    <div className="hero-status-row">
      {props.statusMessage ? (
        <p className="callout callout-success">{props.statusMessage}</p>
      ) : null}
      {props.errorMessage ? <p className="callout callout-error">{props.errorMessage}</p> : null}
    </div>
  );
}

function resolveBoardMirrorBaseUrl(
  previewUrl: string | undefined,
  coverageSummary: GuiCoverageSummary | null,
  archiveSummary: GuiArchiveSummary | null,
): string | undefined {
  return previewUrl ?? coverageSummary?.mirrorUrl ?? archiveSummary?.mirrorUrl;
}

function resolveOverviewUnavailableCount(coverageSummary: GuiCoverageSummary | null): number {
  const official = coverageSummary?.officialSourceUnavailableUpstreamCount ?? 0;
  const tests = coverageSummary?.testsUnavailableUpstreamCount ?? 0;
  return official + tests;
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
  const [syncedWorkspaceRoot, setSyncedWorkspaceRoot] = useState(workspaceState?.workspaceRoot);
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

  // Keep the workspace path input in sync with an externally updated workspace
  // root by adjusting state during render (the React-recommended alternative to
  // resetting state from an effect). The draft only follows the canonical root
  // when the root actually changes, so user edits between updates are kept.
  if (shouldSyncWorkspaceDraft(workspaceState, syncedWorkspaceRoot)) {
    setSyncedWorkspaceRoot(workspaceState!.workspaceRoot);
    setWorkspaceDraft(workspaceState!.workspaceRoot);
  }

  const activeProfile = useMemo(() => getActiveProfile(workspaceState), [workspaceState]);
  const activeCrawlJob = useMemo(
    () => [...jobs].reverse().find((job) => job.kind === 'crawl'),
    [jobs],
  );
  const visibleLogEntries = useMemo(
    () => filterLogEntries(jobEvents.length > 0 ? jobEvents : buildLogEntries(jobs), verbosityMode),
    [jobEvents, jobs, verbosityMode],
  );
  const recentFailureCount = countRecentFailures(crawlStatus);
  const crawlTelemetry = useMemo(
    () => deriveCrawlTelemetry(crawlStatus ?? activeCrawlJob?.latestCounters, jobEvents),
    [activeCrawlJob?.latestCounters, crawlStatus, jobEvents],
  );
  const overviewPreset = useMemo(() => detectOverviewPreset(coverageFilters), [coverageFilters]);
  const overviewRows = useMemo(() => (coverageListing?.items ?? []).slice(0, 8), [coverageListing]);
  const boardMirrorBaseUrl = resolveBoardMirrorBaseUrl(previewUrl, coverageSummary, archiveSummary);
  const overviewUnavailableCount = resolveOverviewUnavailableCount(coverageSummary);

  const applyOverviewPreset = (preset: OverviewBoardPreset) => {
    onCoverageFiltersChange(createCoverageFiltersForPreset(preset));
  };

  const openCoverageFromOverview = (problemId: number) => {
    onSelectCoverageProblem(problemId);
    setActiveView('coverage');
  };

  const openMirrorFromOverview = (record: GuiCoverageRecord) => {
    if (!boardMirrorBaseUrl) {
      return;
    }
    void onOpenExternal(new URL(record.mirrorRoute, boardMirrorBaseUrl).toString());
  };

  if (workspaceState === undefined) {
    return (
      <main className="desktop-shell">
        <section className="panel">
          <p>Loading desktop state…</p>
        </section>
      </main>
    );
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
            A lighter control surface for continuing the crawl, checking coverage, and opening the
            local archive.
          </p>
        </div>
        <DashboardTopbarStatus
          selectedSnapshotId={selectedSnapshotId}
          crawlStatus={crawlStatus}
          workspaceRoot={workspaceState?.workspaceRoot}
          activeProfile={activeProfile}
          activeCrawlJob={activeCrawlJob}
          recentFailureCount={recentFailureCount}
          busyAction={busyAction}
          onRefresh={onRefresh}
        />
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

      <DashboardHeroStatusRow statusMessage={statusMessage} errorMessage={errorMessage} />

      {workspaceState === null ? (
        <DashboardWorkspaceBootstrap
          workspaceDraft={workspaceDraft}
          setWorkspaceDraft={setWorkspaceDraft}
          onSelectWorkspace={onSelectWorkspace}
        />
      ) : (
        <div className="dashboard-grid">
          <DashboardSetupView
            active={activeView === 'setup'}
            workspaceState={workspaceState}
            activeProfile={activeProfile}
            selectedSnapshotId={selectedSnapshotId}
            showAdvanced={showAdvanced}
            recentFailureCount={recentFailureCount}
            crawlStatus={crawlStatus}
            loginForm={loginForm}
            importForm={importForm}
            setLoginForm={setLoginForm}
            setImportForm={setImportForm}
            onSnapshotChange={onSnapshotChange}
            onLoginProfile={onLoginProfile}
            onImportBrowserProfile={onImportBrowserProfile}
            onActivateProfile={onActivateProfile}
            onDeleteProfile={onDeleteProfile}
            onToggleAdvanced={onToggleAdvanced}
          />
          <DashboardOverviewView
            active={activeView === 'overview'}
            selectedSnapshotId={selectedSnapshotId}
            crawlStatus={crawlStatus}
            recentFailureCount={recentFailureCount}
            crawlTelemetry={crawlTelemetry}
            publishCommand={publishCommand}
            coverageSummary={coverageSummary}
            coverageListing={coverageListing}
            overviewPreset={overviewPreset}
            overviewRows={overviewRows}
            overviewUnavailableCount={overviewUnavailableCount}
            boardMirrorBaseUrl={boardMirrorBaseUrl}
            jobs={jobs}
            activeCrawlJob={activeCrawlJob}
            selectedCrawlMode={selectedCrawlMode}
            verbosityMode={verbosityMode}
            visibleLogEntries={visibleLogEntries}
            previewUrl={previewUrl}
            previewJobId={previewJobId}
            showEmbeddedPreview={showEmbeddedPreview}
            setShowEmbeddedPreview={setShowEmbeddedPreview}
            setActiveView={setActiveView}
            applyOverviewPreset={applyOverviewPreset}
            openCoverageFromOverview={openCoverageFromOverview}
            openMirrorFromOverview={openMirrorFromOverview}
            onCrawlModeChange={onCrawlModeChange}
            onVerbosityChange={onVerbosityChange}
            onStartCrawl={onStartCrawl}
            onPauseCrawl={onPauseCrawl}
            onResumeCrawl={onResumeCrawl}
            onRunSnapshotJob={onRunSnapshotJob}
            onStartMirrorPreview={onStartMirrorPreview}
            onStopMirrorPreview={onStopMirrorPreview}
            onOpenExternal={onOpenExternal}
          />
          <DashboardCoverageView
            active={activeView === 'coverage'}
            selectedSnapshotId={selectedSnapshotId}
            coverageSummary={coverageSummary}
            coverageListing={coverageListing}
            coverageDetail={coverageDetail}
            selectedCoverageProblemId={selectedCoverageProblemId}
            coverageFilters={coverageFilters}
            previewUrl={previewUrl}
            onCoverageFiltersChange={onCoverageFiltersChange}
            onSelectCoverageProblem={onSelectCoverageProblem}
            onOpenPath={onOpenPath}
            onOpenExternal={onOpenExternal}
          />
          <DashboardDataView
            active={activeView === 'data'}
            selectedSnapshotId={selectedSnapshotId}
            archiveSummary={archiveSummary}
            selectedArchiveDataset={selectedArchiveDataset}
            selectedArchiveRecordId={selectedArchiveRecordId}
            archiveQuery={archiveQuery}
            archiveListing={archiveListing}
            archiveRecordDetail={archiveRecordDetail}
            previewUrl={previewUrl}
            onArchiveDatasetChange={onArchiveDatasetChange}
            onArchiveQueryChange={onArchiveQueryChange}
            onSelectArchiveRecord={onSelectArchiveRecord}
            onOpenPath={onOpenPath}
            onOpenExternal={onOpenExternal}
          />
        </div>
      )}
    </main>
  );
}

function DashboardWorkspaceBootstrap(props: {
  workspaceDraft: string;
  setWorkspaceDraft: Dispatch<SetStateAction<string>>;
  onSelectWorkspace: (workspaceRoot: string) => Promise<unknown>;
}) {
  const { workspaceDraft, setWorkspaceDraft, onSelectWorkspace } = props;
  return (
    <section className="panel empty-state bootstrap-panel">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Workspace bootstrap</p>
          <h2>Choose a workspace</h2>
        </div>
      </div>
      <p className="summary-copy">
        Keep queues, logs, profiles, and snapshots in a portable workspace folder.
      </p>
      <form
        className="stack-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onSelectWorkspace(workspaceDraft);
        }}
      >
        <label className="field">
          <span>Workspace path</span>
          <input
            value={workspaceDraft}
            onChange={(event) => setWorkspaceDraft(event.target.value)}
            placeholder="C:/pbinfo-workspace"
          />
        </label>
        <button className="primary-button" type="submit" disabled={!workspaceDraft}>
          Select workspace
        </button>
      </form>
    </section>
  );
}

function DashboardCoverageView(props: {
  active: boolean;
  selectedSnapshotId: string;
  coverageSummary: GuiCoverageSummary | null;
  coverageListing: GuiCoverageListing | null;
  coverageDetail: GuiCoverageDetail | null;
  selectedCoverageProblemId: number | null;
  coverageFilters: CoverageExplorerFilters;
  previewUrl?: string;
  onCoverageFiltersChange: (next: CoverageExplorerFilters) => void;
  onSelectCoverageProblem: (problemId: number) => void;
  onOpenPath: (path: string) => Promise<unknown>;
  onOpenExternal: (url: string) => Promise<unknown>;
}) {
  if (!props.active) {
    return null;
  }
  return (
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
  );
}

function DashboardDataView(props: {
  active: boolean;
  selectedSnapshotId: string;
  archiveSummary: GuiArchiveSummary | null;
  selectedArchiveDataset: GuiArchiveDataset;
  selectedArchiveRecordId: string | null;
  archiveQuery: string;
  archiveListing: GuiArchiveListing | null;
  archiveRecordDetail: GuiArchiveRecordDetail | null;
  previewUrl?: string;
  onArchiveDatasetChange: (dataset: GuiArchiveDataset) => void;
  onArchiveQueryChange: (query: string) => void;
  onSelectArchiveRecord: (recordId: string) => void;
  onOpenPath: (path: string) => Promise<unknown>;
  onOpenExternal: (url: string) => Promise<unknown>;
}) {
  if (!props.active) {
    return null;
  }
  const { archiveSummary } = props;
  return (
    <DataExplorerPanel
      snapshotId={props.selectedSnapshotId}
      normalizedRoot={archiveSummary?.normalizedRoot}
      mirrorRoot={archiveSummary?.mirrorRoot}
      mirrorServeCommand={archiveSummary?.mirrorServeCommand}
      mirrorUrl={archiveSummary?.mirrorUrl}
      datasetSummaries={archiveSummary?.datasets ?? []}
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
  );
}

interface DashboardSetupViewProps {
  active: boolean;
  workspaceState: GuiWorkspaceState;
  activeProfile: GuiProfileRecord | undefined;
  selectedSnapshotId: string;
  showAdvanced: boolean;
  recentFailureCount: number;
  crawlStatus: GuiCrawlStatus | null;
  loginForm: CredentialLoginInput;
  importForm: BrowserImportInput;
  setLoginForm: Dispatch<SetStateAction<CredentialLoginInput>>;
  setImportForm: Dispatch<SetStateAction<BrowserImportInput>>;
  onSnapshotChange: (snapshotId: string) => void;
  onLoginProfile: (input: CredentialLoginInput) => Promise<unknown>;
  onImportBrowserProfile: (input: BrowserImportInput) => Promise<unknown>;
  onActivateProfile: (profileId: string) => Promise<unknown>;
  onDeleteProfile: (profileId: string) => Promise<unknown>;
  onToggleAdvanced: () => void;
}

function DashboardSetupView(props: DashboardSetupViewProps) {
  if (!props.active) {
    return null;
  }
  const {
    workspaceState,
    activeProfile,
    selectedSnapshotId,
    showAdvanced,
    recentFailureCount,
    crawlStatus,
    loginForm,
    importForm,
    setLoginForm,
    setImportForm,
    onSnapshotChange,
    onLoginProfile,
    onImportBrowserProfile,
    onActivateProfile,
    onDeleteProfile,
    onToggleAdvanced,
  } = props;
  return (
    <>
      <DashboardSetupWorkspacePanel
        workspaceState={workspaceState}
        activeProfile={activeProfile}
        selectedSnapshotId={selectedSnapshotId}
        onSnapshotChange={onSnapshotChange}
        onActivateProfile={onActivateProfile}
        onDeleteProfile={onDeleteProfile}
      />
      <DashboardSetupAuthPanel
        loginForm={loginForm}
        importForm={importForm}
        setLoginForm={setLoginForm}
        setImportForm={setImportForm}
        onLoginProfile={onLoginProfile}
        onImportBrowserProfile={onImportBrowserProfile}
      />
      <section className="panel setup-panel-toggle">
        <div className="button-row">
          <button className="ghost-button" type="button" onClick={onToggleAdvanced}>
            {showAdvanced ? 'Hide advanced settings' : 'Advanced Settings'}
          </button>
        </div>
      </section>
      {showAdvanced ? (
        <DashboardSetupAdvancedPanel
          workspaceState={workspaceState}
          recentFailureCount={recentFailureCount}
          crawlStatus={crawlStatus}
        />
      ) : null}
    </>
  );
}

function DashboardSetupWorkspacePanel(props: {
  workspaceState: GuiWorkspaceState;
  activeProfile: GuiProfileRecord | undefined;
  selectedSnapshotId: string;
  onSnapshotChange: (snapshotId: string) => void;
  onActivateProfile: (profileId: string) => Promise<unknown>;
  onDeleteProfile: (profileId: string) => Promise<unknown>;
}) {
  const {
    workspaceState,
    activeProfile,
    selectedSnapshotId,
    onSnapshotChange,
    onActivateProfile,
    onDeleteProfile,
  } = props;
  return (
    <section className="panel workspace-panel">
              <PanelHeading
                kicker="Workspace and identity"
                title="Workspace"
                chip={`${workspaceState.profiles.length} profiles`}
              />
              <div className="workspace-summary">
                <SummaryCard label="Workspace root">
                  <p className="mono">{workspaceState.workspaceRoot}</p>
                </SummaryCard>
                <SummaryCard
                  label="Active profile"
                  value={activeProfile?.label ?? 'No active profile'}
                >
                  <p className="summary-copy">
                    {activeProfile?.userHandle
                      ? `Handle: ${activeProfile.userHandle}`
                      : 'Create or import a PBInfo session profile to enable authenticated crawl work.'}
                  </p>
                </SummaryCard>
                <SummaryCard label="Snapshot target">
                  <input
                    value={selectedSnapshotId}
                    onChange={(event) => onSnapshotChange(event.target.value)}
                    placeholder="acceptance-20260310b"
                  />
                  <p className="summary-copy">Canonical drain target and mirror build source.</p>
                </SummaryCard>
              </div>
              <div className="profile-list">
                {workspaceState.profiles.length === 0 ? (
                  <p className="summary-copy">No saved PBInfo profiles yet.</p>
                ) : (
                  workspaceState.profiles.map((profile) => (
                    <article className="job-card profile-card" key={profile.profileId}>
                      <header>
                        <div>
                          <strong>{profile.label}</strong>
                          <p className="job-meta">
                            {profile.profileId} • {formatProfileProvenance(profile)}
                          </p>
                        </div>
                        {workspaceState.activeProfileId === profile.profileId ? (
                          <span className="status-badge status-completed">active</span>
                        ) : null}
                      </header>
                      <p className="summary-copy">
                        {profile.userHandle
                          ? `Handle ${profile.userHandle}`
                          : 'No user handle saved'}
                      </p>
                      <div className="button-row">
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() => void onActivateProfile(profile.profileId)}
                        >
                          Activate
                        </button>
                        <button
                          className="ghost-button ghost-danger"
                          type="button"
                          onClick={() => void onDeleteProfile(profile.profileId)}
                        >
                          Delete
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
  );
}

function DashboardSetupAuthPanel(props: {
  loginForm: CredentialLoginInput;
  importForm: BrowserImportInput;
  setLoginForm: Dispatch<SetStateAction<CredentialLoginInput>>;
  setImportForm: Dispatch<SetStateAction<BrowserImportInput>>;
  onLoginProfile: (input: CredentialLoginInput) => Promise<unknown>;
  onImportBrowserProfile: (input: BrowserImportInput) => Promise<unknown>;
}) {
  const {
    loginForm,
    importForm,
    setLoginForm,
    setImportForm,
    onLoginProfile,
    onImportBrowserProfile,
  } = props;
  return (
            <section className="panel action-panel">
              <PanelHeading kicker="Authentication lanes" title="Profiles & Access" />
              <div className="auth-grid">
                <form
                  className="stack-form summary-card form-card"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void onLoginProfile(loginForm);
                  }}
                >
                  <strong>Credential login</strong>
                  <p className="summary-copy">
                    Use direct account auth for a crawler-owned session.
                  </p>
                  <Field label="Profile id">
                    <input
                      value={loginForm.profileId}
                      onChange={(event) =>
                        setLoginForm((current) => ({ ...current, profileId: event.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Label">
                    <input
                      value={loginForm.label}
                      onChange={(event) =>
                        setLoginForm((current) => ({ ...current, label: event.target.value }))
                      }
                    />
                  </Field>
                  <Field label="User handle">
                    <input
                      value={loginForm.userHandle ?? ''}
                      onChange={(event) =>
                        setLoginForm((current) => ({
                          ...current,
                          userHandle: event.target.value || undefined,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Username">
                    <input
                      value={loginForm.username}
                      onChange={(event) =>
                        setLoginForm((current) => ({ ...current, username: event.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Password">
                    <input
                      type="password"
                      value={loginForm.password}
                      onChange={(event) =>
                        setLoginForm((current) => ({ ...current, password: event.target.value }))
                      }
                    />
                  </Field>
                  <button className="primary-button" type="submit">
                    Sign in
                  </button>
                </form>

                <form
                  className="stack-form summary-card form-card"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void onImportBrowserProfile(importForm);
                  }}
                >
                  <strong>Browser import</strong>
                  <p className="summary-copy">
                    Reuse a verified local browser session when that is the fastest path.
                  </p>
                  <Field label="Profile id">
                    <input
                      value={importForm.profileId}
                      onChange={(event) =>
                        setImportForm((current) => ({ ...current, profileId: event.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Label">
                    <input
                      value={importForm.label}
                      onChange={(event) =>
                        setImportForm((current) => ({ ...current, label: event.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Browser">
                    <select
                      value={importForm.browser}
                      onChange={(event) =>
                        setImportForm((current) => ({
                          ...current,
                          browser: event.target.value as BrowserImportInput['browser'],
                        }))
                      }
                    >
                      <option value="edge">Edge</option>
                      <option value="chrome">Chrome</option>
                    </select>
                  </Field>
                  <Field label="Browser profile">
                    <input
                      value={importForm.profileName ?? ''}
                      onChange={(event) =>
                        setImportForm((current) => ({
                          ...current,
                          profileName: event.target.value || undefined,
                        }))
                      }
                    />
                  </Field>
                  <Field label="User handle">
                    <input
                      value={importForm.userHandle ?? ''}
                      onChange={(event) =>
                        setImportForm((current) => ({
                          ...current,
                          userHandle: event.target.value || undefined,
                        }))
                      }
                    />
                  </Field>
                  <button className="primary-button" type="submit">
                    Import browser cookies
                  </button>
                </form>
              </div>
            </section>
  );
}

interface DashboardOverviewViewProps {
  active: boolean;
  selectedSnapshotId: string;
  crawlStatus: GuiCrawlStatus | null;
  recentFailureCount: number;
  crawlTelemetry: { completedPerMinute: number; etaSeconds: number } | null;
  publishCommand: string | null;
  coverageSummary: GuiCoverageSummary | null;
  coverageListing: GuiCoverageListing | null;
  overviewPreset: OverviewBoardPreset | null;
  overviewRows: GuiCoverageRecord[];
  overviewUnavailableCount: number;
  boardMirrorBaseUrl?: string;
  jobs: GuiJobRecord[];
  activeCrawlJob: GuiJobRecord | undefined;
  selectedCrawlMode: CrawlMode;
  verbosityMode: VerbosityMode;
  visibleLogEntries: GuiJobEvent[];
  previewUrl?: string;
  previewJobId?: string;
  showEmbeddedPreview: boolean;
  setShowEmbeddedPreview: Dispatch<SetStateAction<boolean>>;
  setActiveView: Dispatch<SetStateAction<DashboardView>>;
  applyOverviewPreset: (preset: OverviewBoardPreset) => void;
  openCoverageFromOverview: (problemId: number) => void;
  openMirrorFromOverview: (record: GuiCoverageRecord) => void;
  onCrawlModeChange: (mode: CrawlMode) => void;
  onVerbosityChange: (mode: VerbosityMode) => void;
  onStartCrawl: (scope: 'public' | 'user' | 'all') => Promise<unknown>;
  onPauseCrawl: (jobId: string) => Promise<unknown>;
  onResumeCrawl: (jobId: string) => Promise<unknown>;
  onRunSnapshotJob: (
    kind: 'normalize' | 'rank' | 'mirror-build' | 'snapshot-finalize',
  ) => Promise<unknown>;
  onStartMirrorPreview: () => Promise<unknown>;
  onStopMirrorPreview: (jobId: string) => Promise<unknown>;
  onOpenExternal: (url: string) => Promise<unknown>;
}

function DashboardOverviewView(props: DashboardOverviewViewProps) {
  if (!props.active) {
    return null;
  }
  return (
    <>
      <DashboardOverviewSnapshotPanel {...props} />
      <DashboardOverviewBoardPanel {...props} />
      <DashboardOverviewJobsPanel {...props} />
      <DashboardOverviewLogsPanel {...props} />
      <DashboardOverviewMirrorPanel {...props} />
    </>
  );
}

function DashboardOverviewSnapshotPanel(props: DashboardOverviewViewProps) {
  const { selectedSnapshotId, crawlStatus, recentFailureCount, crawlTelemetry, publishCommand } =
    props;
  return (
            <section className="panel snapshot-panel">
              <PanelHeading
                kicker="Archive health"
                title="Archive Overview"
                chip={selectedSnapshotId}
              />
              {crawlStatus ? (
                <div className="snapshot-grid">
                  <SummaryCard label="Queue counts" value={`${crawlStatus.pending} pending`}>
                    <p className="summary-copy">{`${crawlStatus.completed} completed • ${crawlStatus.inProgress} in progress`}</p>
                  </SummaryCard>
                  <SummaryCard
                    label="Publish readiness"
                    value={crawlStatus.publishEligible ? 'Ready' : 'Not ready'}
                  >
                    <p className="summary-copy">
                      {crawlStatus.publishEligible
                        ? 'The canonical snapshot is drained and can be published through the guarded CLI.'
                        : `${recentFailureCount} recent failures recorded.`}
                    </p>
                  </SummaryCard>
                  <SummaryCard
                    label="Real-time ETA"
                    value={crawlTelemetry ? formatEta(crawlTelemetry.etaSeconds) : 'Learning…'}
                  >
                    <p className="summary-copy">
                      {crawlTelemetry
                        ? `${formatRate(crawlTelemetry.completedPerMinute)} completed/min across recent crawl chunks.`
                        : 'ETA appears after enough crawl history accumulates for a stable projection.'}
                    </p>
                  </SummaryCard>
                  <SummaryCard label="Queue DB">
                    <p className="mono">{crawlStatus.queuePath}</p>
                  </SummaryCard>
                </div>
              ) : (
                <p className="summary-copy">
                  Crawl status will appear here after the selected snapshot exists.
                </p>
              )}
              {publishCommand ? (
                <article className="summary-card publish-card">
                  <span className="metric-label">Ready to publish</span>
                  <p className="mono">{publishCommand}</p>
                </article>
              ) : null}
            </section>
  );
}

function DashboardOverviewBoardPanel(props: DashboardOverviewViewProps) {
  const {
    coverageSummary,
    coverageListing,
    overviewPreset,
    overviewRows,
    overviewUnavailableCount,
    boardMirrorBaseUrl,
    setActiveView,
    applyOverviewPreset,
    openCoverageFromOverview,
    openMirrorFromOverview,
  } = props;
  return (
    <section className="panel overview-board-panel">
      <PanelHeading
        kicker="Fast audit"
        title="Problem Status Board"
        chip={overviewPreset ? formatOverviewPreset(overviewPreset) : 'Custom focus'}
      />
      <p className="summary-copy">
        Start here for a quick solved-versus-unsolved picture, then drill into the mirror or the
        full coverage explorer only when you need more detail.
      </p>
      <OverviewStatusGrid
        coverageSummary={coverageSummary}
        overviewPreset={overviewPreset}
        applyOverviewPreset={applyOverviewPreset}
      />
      <OverviewPresetFilterRow
        overviewPreset={overviewPreset}
        applyOverviewPreset={applyOverviewPreset}
      />
      <OverviewMetaRow
        coverageSummary={coverageSummary}
        coverageListing={coverageListing}
        overviewUnavailableCount={overviewUnavailableCount}
        overviewRowCount={overviewRows.length}
      />
      <div className="button-row">
        <button className="ghost-button" type="button" onClick={() => applyOverviewPreset('all')}>
          Reset board focus
        </button>
        <button className="ghost-button" type="button" onClick={() => setActiveView('coverage')}>
          Open full coverage explorer
        </button>
      </div>
      <OverviewProblemList
        coverageListing={coverageListing}
        overviewRows={overviewRows}
        boardMirrorBaseUrl={boardMirrorBaseUrl}
        openCoverageFromOverview={openCoverageFromOverview}
        openMirrorFromOverview={openMirrorFromOverview}
      />
    </section>
  );
}

const OVERVIEW_STATUS_STATS: ReadonlyArray<{
  label: string;
  copy: string;
  tone: 'success' | 'neutral' | 'warning';
  preset: OverviewBoardPreset;
  summaryKey: keyof GuiCoverageSummary;
}> = [
  {
    label: 'Solved',
    copy: 'Problems solved by your archived handle.',
    tone: 'success',
    preset: 'solved',
    summaryKey: 'solvedByMeCount',
  },
  {
    label: 'Unsolved',
    copy: 'Problems still unsolved by the configured handle.',
    tone: 'neutral',
    preset: 'unsolved',
    summaryKey: 'unsolvedProblemCount',
  },
  {
    label: 'Complete',
    copy: 'Problems that already have the archive pieces they need.',
    tone: 'success',
    preset: 'complete',
    summaryKey: 'completeProblemCount',
  },
  {
    label: 'Missing official source',
    copy: 'Actionable official-source capture gaps only.',
    tone: 'warning',
    preset: 'missing-official-source',
    summaryKey: 'missingOfficialSourceCaptureCount',
  },
  {
    label: 'Missing your source',
    copy: 'Solved problems still missing a trustworthy best-per-language user source.',
    tone: 'warning',
    preset: 'missing-user-source',
    summaryKey: 'solvedByMeMissingUserSourceCount',
  },
  {
    label: 'Missing tests',
    copy: 'Problems whose tests still need to be captured.',
    tone: 'warning',
    preset: 'missing-tests',
    summaryKey: 'missingTestsCaptureCount',
  },
];

function OverviewStatusGrid(props: {
  coverageSummary: GuiCoverageSummary | null;
  overviewPreset: OverviewBoardPreset | null;
  applyOverviewPreset: (preset: OverviewBoardPreset) => void;
}) {
  const { coverageSummary, overviewPreset, applyOverviewPreset } = props;
  return (
    <div className="overview-status-grid">
      {OVERVIEW_STATUS_STATS.map((stat) => (
        <StatusBoardStat
          key={stat.preset}
          label={stat.label}
          value={String(coverageSummary?.[stat.summaryKey] ?? 0)}
          copy={stat.copy}
          tone={stat.tone}
          active={overviewPreset === stat.preset}
          onClick={() => applyOverviewPreset(stat.preset)}
        />
      ))}
    </div>
  );
}

const OVERVIEW_PRESET_FILTERS: ReadonlyArray<[OverviewBoardPreset, string]> = [
  ['all', 'All problems'],
  ['solved', 'Solved'],
  ['unsolved', 'Unsolved'],
  ['complete', 'Complete'],
  ['missing-official-source', 'Missing official source'],
  ['missing-user-source', 'Missing your source'],
  ['missing-tests', 'Missing tests'],
];

function OverviewPresetFilterRow(props: {
  overviewPreset: OverviewBoardPreset | null;
  applyOverviewPreset: (preset: OverviewBoardPreset) => void;
}) {
  const { overviewPreset, applyOverviewPreset } = props;
  return (
    <div className="overview-filter-row" role="toolbar" aria-label="Problem status board filters">
      {OVERVIEW_PRESET_FILTERS.map(([preset, label]) => (
        <button
          key={preset}
          className={`dataset-chip ${overviewPreset === preset ? 'dataset-chip-active' : ''}`}
          type="button"
          onClick={() => applyOverviewPreset(preset)}
          aria-pressed={overviewPreset === preset}
        >
          <strong>{label}</strong>
        </button>
      ))}
    </div>
  );
}

function OverviewMetaRow(props: {
  coverageSummary: GuiCoverageSummary | null;
  coverageListing: GuiCoverageListing | null;
  overviewUnavailableCount: number;
  overviewRowCount: number;
}) {
  const { coverageSummary, coverageListing, overviewUnavailableCount, overviewRowCount } = props;
  const officialUnavailable = coverageSummary?.officialSourceUnavailableUpstreamCount ?? 0;
  const testsUnavailable = coverageSummary?.testsUnavailableUpstreamCount ?? 0;
  const focusLabel = coverageListing ? `${coverageListing.totalCount} matches` : 'Loading…';
  return (
    <div className="overview-meta-row">
      <article className="summary-card overview-meta-card">
        <span className="metric-label">Upstream unavailable</span>
        <strong>{String(overviewUnavailableCount)}</strong>
        <p className="summary-copy">
          {String(officialUnavailable)} official and {String(testsUnavailable)} tests are correctly
          classified as unavailable upstream, not missing capture.
        </p>
      </article>
      <article className="summary-card overview-meta-card">
        <span className="metric-label">Current board focus</span>
        <strong>{focusLabel}</strong>
        <p className="summary-copy">
          Showing up to {overviewRowCount} quick-drill rows below. Open Coverage for the full table
          and deeper notes.
        </p>
      </article>
    </div>
  );
}

function OverviewProblemList(props: {
  coverageListing: GuiCoverageListing | null;
  overviewRows: GuiCoverageRecord[];
  boardMirrorBaseUrl?: string;
  openCoverageFromOverview: (problemId: number) => void;
  openMirrorFromOverview: (record: GuiCoverageRecord) => void;
}) {
  const { coverageListing, overviewRows } = props;
  if (coverageListing === null) {
    return (
      <p className="summary-copy">
        Coverage data will appear here after the selected snapshot finishes loading.
      </p>
    );
  }
  if (overviewRows.length === 0) {
    return (
      <div className="mirror-placeholder">
        <strong>No problems match the current board focus.</strong>
        <p>Reset the board focus or open Coverage to adjust the deeper filters.</p>
      </div>
    );
  }
  return (
    <div className="overview-problem-list">
      {overviewRows.map((record) => (
        <OverviewProblemCard
          key={record.problemId}
          record={record}
          boardMirrorBaseUrl={props.boardMirrorBaseUrl}
          openCoverageFromOverview={props.openCoverageFromOverview}
          openMirrorFromOverview={props.openMirrorFromOverview}
        />
      ))}
    </div>
  );
}

function overviewProblemSubtitle(record: GuiCoverageRecord): string {
  const gradePart = typeof record.grade === 'number' ? ` • grade ${record.grade}` : '';
  const tagsPart = record.tags.length > 0 ? ` • ${record.tags.slice(0, 3).join(', ')}` : '';
  return `${record.slug}${gradePart}${tagsPart}`;
}

function OverviewProblemCard(props: {
  record: GuiCoverageRecord;
  boardMirrorBaseUrl?: string;
  openCoverageFromOverview: (problemId: number) => void;
  openMirrorFromOverview: (record: GuiCoverageRecord) => void;
}) {
  const { record, boardMirrorBaseUrl, openCoverageFromOverview, openMirrorFromOverview } = props;
  return (
    <article className="summary-card overview-problem-card">
      <div className="overview-problem-head">
        <div>
          <strong>{`#${record.problemId} ${record.name}`}</strong>
          <p className="summary-copy">{overviewProblemSubtitle(record)}</p>
        </div>
        <span className="panel-chip">{record.mirrorRoute}</span>
      </div>
      <div className="coverage-badge-row overview-badge-row">
        <StatusBadge tone={record.solvedByMe ? 'success' : 'neutral'}>
          {record.solvedByMe ? 'Solved' : 'Unsolved'}
        </StatusBadge>
        <StatusBadge tone={toneForArchiveState(record.archiveCompletenessStatus)}>
          {formatArchiveCompletenessStatus(record.archiveCompletenessStatus)}
        </StatusBadge>
        <StatusBadge tone={toneForOfficialStatus(record.officialSourceStatus)}>
          {formatOfficialSourceStatus(record.officialSourceStatus)}
        </StatusBadge>
        <StatusBadge tone={toneForTestsStatus(record.testsCoverageStatus)}>
          {formatTestsCoverageStatus(record.testsCoverageStatus)}
        </StatusBadge>
        <StatusBadge tone={record.userSourceArchived ? 'success' : 'warning'}>
          {record.userSourceArchived ? 'Your source archived' : 'Your source missing'}
        </StatusBadge>
      </div>
      <p className="summary-copy overview-row-copy">{formatOverviewProblemSummary(record)}</p>
      <div className="button-row">
        <button
          className="ghost-button"
          type="button"
          onClick={() => openCoverageFromOverview(record.problemId)}
        >
          Open coverage detail
        </button>
        <button
          className="ghost-button"
          type="button"
          disabled={!boardMirrorBaseUrl}
          onClick={() => openMirrorFromOverview(record)}
        >
          Open mirror
        </button>
      </div>
    </article>
  );
}

function DashboardOverviewJobsPanel(props: DashboardOverviewViewProps) {
  const {
    jobs,
    activeCrawlJob,
    selectedCrawlMode,
    setActiveView,
    onCrawlModeChange,
    onStartCrawl,
    onPauseCrawl,
    onResumeCrawl,
    onRunSnapshotJob,
  } = props;
  return (
            <section className="panel jobs-panel">
              <PanelHeading
                kicker="Quick actions"
                title="What happens next"
                chip={`${jobs.length} jobs`}
              />
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
                  Incremental sync reuses the canonical archive and skips completed URLs. Fresh
                  recrawl creates a new snapshot from scratch.
                </p>
              </div>
              <div className="action-grid">
                <ActionButton
                  title="Start public crawl"
                  copy="Seed and continue the public PBInfo queue."
                  primary
                  onClick={() => void onStartCrawl('public')}
                />
                <ActionButton
                  title="Start user crawl"
                  copy="Harvest authenticated profile, solution, and evaluation pages."
                  primary
                  onClick={() => void onStartCrawl('user')}
                />
                <ActionButton
                  title="Start full crawl"
                  copy="Drive the canonical same-host drain target."
                  primary
                  onClick={() => void onStartCrawl('all')}
                />
                <ActionButton
                  title="Normalize snapshot"
                  copy="Rebuild normalized records without re-fetching."
                  onClick={() => void onRunSnapshotJob('normalize')}
                />
                <ActionButton
                  title="Rank sources"
                  copy="Refresh user and official best-per-language outputs."
                  onClick={() => void onRunSnapshotJob('rank')}
                />
                <ActionButton
                  title="Build mirror"
                  copy="Rebuild localhost routes and local asset rewrites."
                  onClick={() => void onRunSnapshotJob('mirror-build')}
                />
                <ActionButton
                  title="Finalize snapshot"
                  copy="Normalize, rank, mirror, export, and prune noncanonical state."
                  onClick={() => void onRunSnapshotJob('snapshot-finalize')}
                />
              </div>
              <div className="button-row">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => setActiveView('coverage')}
                >
                  Open coverage
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => setActiveView('data')}
                >
                  Open raw data
                </button>
              </div>
              {activeCrawlJob ? (
                <div className="button-row">
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => void onResumeCrawl(activeCrawlJob.jobId)}
                  >
                    Resume crawl
                  </button>
                  <button
                    className="ghost-button ghost-danger"
                    type="button"
                    onClick={() => void onPauseCrawl(activeCrawlJob.jobId)}
                  >
                    Pause after current chunk completes
                  </button>
                </div>
              ) : null}
              <div className="job-list">
                {jobs.length === 0 ? (
                  <p className="summary-copy">No desktop jobs recorded yet.</p>
                ) : (
                  jobs.map((job) => (
                    <article className="job-card" key={job.jobId}>
                      <header>
                        <div>
                          <strong>{job.snapshotId ?? job.kind}</strong>
                          <p className="job-meta">{formatJobMeta(job)}</p>
                        </div>
                        <span className={`status-badge status-${job.status}`}>{job.status}</span>
                      </header>
                      <p>{formatJobSummary(job)}</p>
                      {job.latestEvent?.message ? (
                        <p className="job-event">{job.latestEvent.message}</p>
                      ) : null}
                    </article>
                  ))
                )}
              </div>
            </section>
  );
}

function DashboardOverviewLogsPanel(props: DashboardOverviewViewProps) {
  const { verbosityMode, visibleLogEntries, onVerbosityChange } = props;
  return (
            <section className="panel logs-panel">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">Structured events</p>
                  <h2>Recent activity</h2>
                </div>
                <div className="panel-actions">
                  <div className="segmented-control" role="group" aria-label="Verbosity">
                    {(['normal', 'verbose', 'raw'] as const).map((mode) => (
                      <button
                        key={mode}
                        className={`segmented-button ${verbosityMode === mode ? 'segmented-button-active' : ''}`}
                        type="button"
                        aria-pressed={verbosityMode === mode}
                        onClick={() => onVerbosityChange(mode)}
                      >
                        {capitalize(mode)}
                      </button>
                    ))}
                  </div>
                  <span className="panel-chip">{visibleLogEntries.length} visible</span>
                </div>
              </div>
              <p className="summary-copy log-summary">
                {verbosityMode === 'normal'
                  ? 'Normal shows the recent operator-facing stream only.'
                  : verbosityMode === 'verbose'
                    ? 'Verbose expands counters and structured detail for each event.'
                    : 'Raw exposes the unfiltered event payloads exactly as captured.'}
              </p>
              {visibleLogEntries.length === 0 ? (
                <p className="summary-copy">
                  Structured job events will appear here during long-running work.
                </p>
              ) : (
                <div className="log-list">
                  {visibleLogEntries.map((entry, index) => (
                    <article
                      className={`log-card log-${entry.level}`}
                      key={`${entry.timestamp}-${index}`}
                    >
                      <header>
                        <span className="log-stage">{entry.stage}</span>
                        <time dateTime={entry.timestamp}>{formatTimestamp(entry.timestamp)}</time>
                      </header>
                      <p>{entry.message}</p>
                      {verbosityMode !== 'normal' && entry.counters ? (
                        <p className="log-counters">{formatCounters(entry.counters)}</p>
                      ) : null}
                      {verbosityMode === 'verbose' && entry.detail ? (
                        <pre className="log-inline-detail">
                          {JSON.stringify(entry.detail, null, 2)}
                        </pre>
                      ) : null}
                      {verbosityMode === 'raw' ? (
                        <pre className="log-inline-detail">{JSON.stringify(entry, null, 2)}</pre>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </section>
  );
}

function DashboardOverviewMirrorPanel(props: DashboardOverviewViewProps) {
  const {
    previewUrl,
    previewJobId,
    showEmbeddedPreview,
    setShowEmbeddedPreview,
    onStartMirrorPreview,
    onStopMirrorPreview,
    onOpenExternal,
  } = props;
  return (
            <section className="panel mirror-panel">
              <PanelHeading
                kicker="Local snapshot"
                title="Mirror access"
                chip={previewUrl ? 'Preview live' : undefined}
              />
              <div className="mirror-stage">
                <div className="mirror-toolbar">
                  <div className="button-row mirror-button-row">
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void onStartMirrorPreview()}
                    >
                      Start preview
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      disabled={!previewJobId}
                      onClick={() => {
                        if (previewJobId) {
                          void onStopMirrorPreview(previewJobId);
                        }
                      }}
                    >
                      Stop preview
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      disabled={!previewUrl}
                      onClick={() => {
                        if (previewUrl) {
                          void onOpenExternal(previewUrl);
                        }
                      }}
                    >
                      Open in browser
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      disabled={!previewUrl}
                      onClick={() => setShowEmbeddedPreview((current) => !current)}
                    >
                      {showEmbeddedPreview ? 'Hide embedded preview' : 'Show embedded preview'}
                    </button>
                  </div>
                  <article className="summary-card mirror-meta-card">
                    <span className="metric-label">Mirror route</span>
                    <p className="mono mirror-address">{previewUrl ?? 'Not running'}</p>
                  </article>
                </div>
                {previewUrl && showEmbeddedPreview ? (
                  <div className="mirror-frame-shell">
                    <iframe className="mirror-frame" src={previewUrl} title="Mirror preview" />
                  </div>
                ) : (
                  <div className="mirror-placeholder">
                    <strong>
                      {previewUrl ? 'Embedded preview hidden' : 'No mirror preview running'}
                    </strong>
                    <p>
                      {previewUrl
                        ? 'Keep the shell lightweight and open the embedded preview only when you need to inspect the full mirror in-place.'
                        : 'Start the mirror preview after building the selected snapshot to embed the localhost viewer here.'}
                    </p>
                  </div>
                )}
              </div>
            </section>
  );
}

function DashboardSetupAdvancedPanel(props: {
  workspaceState: GuiWorkspaceState;
  recentFailureCount: number;
  crawlStatus: GuiCrawlStatus | null;
}) {
  const { workspaceState, recentFailureCount, crawlStatus } = props;
  return (
    <section className="panel advanced-panel">
      <PanelHeading
        kicker="Operator defaults"
        title="Advanced Settings"
        chip="Read-only diagnostics"
      />
      <div className="advanced-grid">
        <SummaryCard
          label="Desktop banners"
          value={workspaceState.notifications.desktopBanners ? 'Enabled' : 'Disabled'}
        />
        <SummaryCard
          label="Windows toast"
          value={workspaceState.notifications.windowsToast ? 'Enabled' : 'Disabled'}
        />
        <SummaryCard label="Recent failures" value={String(recentFailureCount)}>
          <p className="summary-copy">
            {crawlStatus?.recentFailures[0]?.lastError ?? 'No recent crawl failures.'}
          </p>
        </SummaryCard>
      </div>
    </section>
  );
}

function resolveTopbarStatusCopy(input: {
  crawlStatus: GuiCrawlStatus | null;
  activeCrawlJob: GuiJobRecord | undefined;
  activeProfile: GuiProfileRecord | undefined;
  recentFailureCount: number;
}): {
  snapshotCopy: string;
  profileValue: string;
  profileCopy: string;
  queueValue: string;
  queueCopy: string;
} {
  const { crawlStatus, activeCrawlJob, activeProfile, recentFailureCount } = input;
  const publishEligible = Boolean(crawlStatus?.publishEligible);
  const queue = resolveTopbarQueueCopy(
    publishEligible,
    crawlStatus,
    activeCrawlJob,
    recentFailureCount,
  );
  return {
    snapshotCopy: publishEligible ? 'Drained and publish-ready.' : 'Current archive target.',
    profileValue: activeProfile?.label ?? 'No active profile',
    profileCopy: resolveTopbarProfileCopy(activeProfile),
    queueValue: queue.value,
    queueCopy: queue.copy,
  };
}

function resolveTopbarProfileCopy(activeProfile: GuiProfileRecord | undefined): string {
  return activeProfile?.userHandle
    ? `Handle ${activeProfile.userHandle}`
    : 'Use Setup to import or sign in.';
}

function resolveTopbarQueueCopy(
  publishEligible: boolean,
  crawlStatus: GuiCrawlStatus | null,
  activeCrawlJob: GuiJobRecord | undefined,
  recentFailureCount: number,
): { value: string; copy: string } {
  if (publishEligible) {
    return { value: 'Ready', copy: 'The canonical snapshot is ready for review.' };
  }
  return {
    value: formatCounters(crawlStatus ?? activeCrawlJob?.latestCounters),
    copy: `${recentFailureCount} recent failures tracked.`,
  };
}

function DashboardTopbarStatus(props: {
  selectedSnapshotId: string;
  crawlStatus: GuiCrawlStatus | null;
  workspaceRoot?: string;
  activeProfile: GuiProfileRecord | undefined;
  activeCrawlJob: GuiJobRecord | undefined;
  recentFailureCount: number;
  busyAction: string | null;
  onRefresh: () => Promise<unknown>;
}) {
  const {
    selectedSnapshotId,
    crawlStatus,
    workspaceRoot,
    activeProfile,
    activeCrawlJob,
    recentFailureCount,
    busyAction,
    onRefresh,
  } = props;
  const status = resolveTopbarStatusCopy({
    crawlStatus,
    activeCrawlJob,
    activeProfile,
    recentFailureCount,
  });
  return (
    <div className="topbar-status-grid">
      <SummaryCard label="Snapshot" value={selectedSnapshotId}>
        <p className="summary-copy">{status.snapshotCopy}</p>
        {workspaceRoot ? <p className="summary-copy mono">{workspaceRoot}</p> : null}
      </SummaryCard>
      <SummaryCard label="Profile" value={status.profileValue}>
        <p className="summary-copy">{status.profileCopy}</p>
      </SummaryCard>
      <SummaryCard label="Queue" value={status.queueValue}>
        <p className="summary-copy">{status.queueCopy}</p>
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
  );
}

function PanelHeading({ kicker, title, chip }: { kicker: string; title: string; chip?: string }) {
  return (
    <div className="panel-heading">
      <div>
        <p className="section-kicker">{kicker}</p>
        <h2>{title}</h2>
      </div>
      {chip ? <span className="panel-chip">{chip}</span> : null}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: ReactNode;
}) {
  return (
    <article className="summary-card">
      <span className="metric-label">{label}</span>
      {value ? <strong>{value}</strong> : null}
      {children}
    </article>
  );
}

function StatusBoardStat({
  label,
  value,
  copy,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: string;
  copy: string;
  tone: 'success' | 'warning' | 'neutral';
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`summary-card overview-stat-card overview-stat-${tone} ${active ? 'overview-stat-active' : ''}`.trim()}
      type="button"
      onClick={onClick}
      aria-pressed={active}
    >
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <span className="summary-copy">{copy}</span>
    </button>
  );
}

function StatusBadge({
  tone,
  children,
}: {
  tone: 'success' | 'warning' | 'neutral';
  children: ReactNode;
}) {
  return <span className={`coverage-badge overview-badge overview-badge-${tone}`}>{children}</span>;
}

function ActionButton({
  title,
  copy,
  primary,
  onClick,
}: {
  title: string;
  copy: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`action-card ${primary ? 'action-primary' : ''}`}
      type="button"
      onClick={onClick}
    >
      <strong>{title}</strong>
      <span>{copy}</span>
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function getActiveProfile(
  workspaceState: GuiWorkspaceState | null | undefined,
): GuiProfileRecord | undefined {
  return workspaceState?.profiles.find(
    (profile) => profile.profileId === workspaceState.activeProfileId,
  );
}

function buildLogEntries(jobs: GuiJobRecord[]): GuiJobEvent[] {
  return jobs
    .filter((job) => job.latestEvent)
    .map((job) => job.latestEvent!)
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
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

function formatCounters(
  counters: GuiJobCounters | { pending: number; completed: number; inProgress: number } | undefined,
): string {
  if (!counters) {
    return 'No queue counters yet';
  }
  const numberFormat = new Intl.NumberFormat('en-US');
  return `${numberFormat.format(counters.pending)} pending, ${numberFormat.format(counters.completed)} completed, ${numberFormat.format(counters.inProgress)} in progress`;
}

function collectCrawlTelemetryEvents(jobEvents: GuiJobEvent[]): GuiJobEvent[] {
  return [...jobEvents]
    .filter(
      (event) => (event.stage === 'crawl' || event.stage === 'crawl-stalled') && event.counters,
    )
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function resolveTelemetryRate(latest: GuiJobEvent, baseline: GuiJobEvent): number | null {
  if (!latest.counters || !baseline.counters) {
    return null;
  }
  const elapsedSeconds =
    (new Date(latest.timestamp).getTime() - new Date(baseline.timestamp).getTime()) / 1_000;
  const completedDelta = latest.counters.completed - baseline.counters.completed;
  if (elapsedSeconds <= 0 || completedDelta <= 0) {
    return null;
  }

  const completedPerMinute = completedDelta / (elapsedSeconds / 60);
  return Number.isFinite(completedPerMinute) && completedPerMinute > 0 ? completedPerMinute : null;
}

function deriveCrawlTelemetry(
  counters:
    | GuiJobCounters
    | { pending: number; completed: number; inProgress: number }
    | null
    | undefined,
  jobEvents: GuiJobEvent[],
): { completedPerMinute: number; etaSeconds: number } | null {
  if (!counters || counters.pending <= 0) {
    return null;
  }

  const relevantEvents = collectCrawlTelemetryEvents(jobEvents);
  const latest = relevantEvents.at(-1);
  const latestCounters = latest?.counters;
  if (relevantEvents.length < 2 || !latest || !latestCounters) {
    return null;
  }

  const baseline = [...relevantEvents]
    .reverse()
    .find(
      (event) =>
        event !== latest && event.counters && event.counters.completed < latestCounters.completed,
    );
  if (!baseline) {
    return null;
  }

  const completedPerMinute = resolveTelemetryRate(latest, baseline);
  if (completedPerMinute === null) {
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
  return minutes === 0 ? `${hours}h remaining` : `${hours}h ${minutes}m remaining`;
}

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function createCoverageFiltersForPreset(preset: OverviewBoardPreset): CoverageExplorerFilters {
  switch (preset) {
    case 'solved':
      return {
        ...DEFAULT_COVERAGE_FILTERS,
        solved: 'solved',
      };
    case 'unsolved':
      return {
        ...DEFAULT_COVERAGE_FILTERS,
        solved: 'unsolved',
      };
    case 'complete':
      return {
        ...DEFAULT_COVERAGE_FILTERS,
        archiveCompletenessStatus: 'complete',
      };
    case 'missing-official-source':
      return {
        ...DEFAULT_COVERAGE_FILTERS,
        archiveCompletenessStatus: 'missing-official-source',
      };
    case 'missing-user-source':
      return {
        ...DEFAULT_COVERAGE_FILTERS,
        archiveCompletenessStatus: 'missing-user-source',
      };
    case 'missing-tests':
      return {
        ...DEFAULT_COVERAGE_FILTERS,
        testsCoverageStatus: 'not-captured-yet',
      };
    case 'all':
    default:
      return {
        ...DEFAULT_COVERAGE_FILTERS,
      };
  }
}

function detectOverviewPreset(filters: CoverageExplorerFilters): OverviewBoardPreset | null {
  const presets: OverviewBoardPreset[] = [
    'all',
    'solved',
    'unsolved',
    'complete',
    'missing-official-source',
    'missing-user-source',
    'missing-tests',
  ];
  return (
    presets.find((preset) =>
      areCoverageFiltersEqual(filters, createCoverageFiltersForPreset(preset)),
    ) ?? null
  );
}

function areCoverageFiltersEqual(
  left: CoverageExplorerFilters,
  right: CoverageExplorerFilters,
): boolean {
  return (
    left.query === right.query &&
    left.solved === right.solved &&
    left.testsFragmentArchived === right.testsFragmentArchived &&
    left.visibleTestsCaptured === right.visibleTestsCaptured &&
    left.testsCoverageStatus === right.testsCoverageStatus &&
    left.officialSourceArchived === right.officialSourceArchived &&
    left.userSourceArchived === right.userSourceArchived &&
    left.editorialAvailability === right.editorialAvailability &&
    left.archiveCompletenessStatus === right.archiveCompletenessStatus &&
    left.grade === right.grade
  );
}

function formatOverviewPreset(preset: OverviewBoardPreset): string {
  switch (preset) {
    case 'all':
      return 'All problems';
    case 'solved':
      return 'Solved';
    case 'unsolved':
      return 'Unsolved';
    case 'complete':
      return 'Complete';
    case 'missing-official-source':
      return 'Missing official source';
    case 'missing-user-source':
      return 'Missing your source';
    case 'missing-tests':
      return 'Missing tests';
  }
}

function toneForArchiveState(
  status: GuiCoverageRecord['archiveCompletenessStatus'],
): 'success' | 'warning' | 'neutral' {
  switch (status) {
    case 'complete':
      return 'success';
    case 'unsolved':
      return 'neutral';
    default:
      return 'warning';
  }
}

function toneForOfficialStatus(
  status: GuiCoverageRecord['officialSourceStatus'],
): 'success' | 'warning' | 'neutral' {
  switch (status) {
    case 'archived':
      return 'success';
    case 'restricted-upstream':
    case 'not-available-upstream':
      return 'neutral';
    case 'not-captured-yet':
    default:
      return 'warning';
  }
}

function toneForTestsStatus(
  status: GuiCoverageRecord['testsCoverageStatus'],
): 'success' | 'warning' | 'neutral' {
  switch (status) {
    case 'captured':
      return 'success';
    case 'not-available-upstream':
      return 'neutral';
    case 'not-captured-yet':
    default:
      return 'warning';
  }
}

function formatArchiveCompletenessStatus(
  status: GuiCoverageRecord['archiveCompletenessStatus'],
): string {
  switch (status) {
    case 'complete':
      return 'Complete';
    case 'unsolved':
      return 'Unsolved';
    case 'not-archived-yet':
      return 'Not archived yet';
    case 'missing-official-source':
      return 'Missing official source';
    case 'missing-user-source':
      return 'Missing your source';
    case 'incomplete':
      return 'Missing tests';
  }
}

function formatOfficialSourceStatus(status: GuiCoverageRecord['officialSourceStatus']): string {
  switch (status) {
    case 'archived':
      return 'Official source archived';
    case 'restricted-upstream':
      return 'Official source restricted';
    case 'not-available-upstream':
      return 'Official source unavailable upstream';
    case 'not-captured-yet':
      return 'Official source not captured yet';
  }
}

function formatTestsCoverageStatus(status: GuiCoverageRecord['testsCoverageStatus']): string {
  switch (status) {
    case 'captured':
      return 'Tests archived';
    case 'not-available-upstream':
      return 'Tests unavailable upstream';
    case 'not-captured-yet':
      return 'Tests not captured yet';
  }
}

function formatOverviewProblemSummary(record: GuiCoverageRecord): string {
  const segments = [`${record.solvedEvaluationCount}/${record.evaluationCount} solved evaluations`];
  if (record.requiredTrustworthyUserSourceLanguages.length > 0) {
    segments.push(
      `required languages: ${record.requiredTrustworthyUserSourceLanguages.join(', ')}`,
    );
  }
  if (record.officialSourceLanguages.length > 0) {
    segments.push(`official langs: ${record.officialSourceLanguages.join(', ')}`);
  }
  if (record.userSourceLanguages.length > 0) {
    segments.push(`your langs: ${record.userSourceLanguages.join(', ')}`);
  }
  if (record.missingTrustworthyUserSourceLanguages.length > 0) {
    segments.push(
      `missing trustworthy: ${record.missingTrustworthyUserSourceLanguages.join(', ')}`,
    );
  }
  return segments.join(' • ');
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
