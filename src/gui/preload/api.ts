import type { DesktopBridge, DesktopBridgeAdapter } from '../shared/bridge.js';

export function buildDesktopBridge(adapter: DesktopBridgeAdapter) {
  return {
    preferences: {
      async get() {
        return adapter.invoke('desktop:preferences:get');
      },
      async set(payload: { verbosityMode: 'normal' | 'verbose' | 'raw' }) {
        return adapter.invoke('desktop:preferences:set', payload);
      },
    },
    workspace: {
      async state() {
        return adapter.invoke('desktop:workspace:state');
      },
      async select(payload: { workspaceRoot: string }) {
        return adapter.invoke('desktop:workspace:select', payload);
      },
    },
    auth: {
      async login(payload: unknown) {
        return adapter.invoke('desktop:auth:login', payload);
      },
      async importBrowser(payload: unknown) {
        return adapter.invoke('desktop:auth:import-browser', payload);
      },
    },
    profiles: {
      async create(payload: unknown) {
        return adapter.invoke('desktop:profiles:create', payload);
      },
      async activate(profileId: string) {
        return adapter.invoke('desktop:profiles:activate', { profileId });
      },
      async delete(profileId: string) {
        return adapter.invoke('desktop:profiles:delete', { profileId });
      },
    },
    archive: {
      async summary(payload?: unknown) {
        return adapter.invoke('desktop:archive:summary', payload);
      },
      async list(payload: unknown) {
        return adapter.invoke('desktop:archive:list', payload);
      },
      async detail(payload: unknown) {
        return adapter.invoke('desktop:archive:detail', payload);
      },
    },
    coverage: {
      async summary(payload?: unknown) {
        return adapter.invoke('desktop:coverage:summary', payload);
      },
      async list(payload: unknown) {
        return adapter.invoke('desktop:coverage:list', payload);
      },
      async detail(payload: unknown) {
        return adapter.invoke('desktop:coverage:detail', payload);
      },
    },
    crawl: {
      async status(payload?: unknown) {
        return adapter.invoke('desktop:crawl:status', payload);
      },
    },
    jobs: {
      async list() {
        return adapter.invoke('desktop:jobs:list');
      },
      async events(payload: { jobId: string; limit?: number }) {
        return adapter.invoke('desktop:jobs:events', payload);
      },
      async start(payload: unknown) {
        return adapter.invoke('desktop:jobs:start', payload);
      },
      async pause(jobId: string) {
        return adapter.invoke('desktop:jobs:pause', { jobId });
      },
      async resume(jobId: string, payload?: { maxIterations?: number }) {
        return adapter.invoke('desktop:jobs:resume', {
          jobId,
          ...payload,
        });
      },
    },
    mirror: {
      async startPreview(payload: { snapshotId: string; port?: number }) {
        return adapter.invoke('desktop:mirror:start-preview', payload);
      },
      async stopPreview(jobId: string) {
        return adapter.invoke('desktop:mirror:stop-preview', { jobId });
      },
    },
    external: {
      async open(url: string) {
        return adapter.invoke('desktop:external:open', { url });
      },
    },
    paths: {
      async open(path: string) {
        return adapter.invoke('desktop:path:open', { path });
      },
    },
    events: {
      subscribe(eventName: string, listener: (payload: unknown) => void) {
        const channel = `desktop:events:${eventName}`;
        const unsubscribe = adapter.on(channel, (...args) => {
          const payload = args.at(-1);
          listener(payload);
        });
        return () => {
          if (typeof unsubscribe === 'function') {
            unsubscribe();
          }
          adapter.off?.(channel);
        };
      },
    },
  };
}

export function createDesktopBridge(adapter: DesktopBridgeAdapter): DesktopBridge {
  const nested = buildDesktopBridge(adapter);
  return {
    async getDesktopPreferences() {
      return (await nested.preferences.get()) as Awaited<
        ReturnType<DesktopBridge['getDesktopPreferences']>
      >;
    },
    async setVerbosityMode(verbosityMode) {
      return (await nested.preferences.set({
        verbosityMode,
      })) as Awaited<ReturnType<DesktopBridge['setVerbosityMode']>>;
    },
    async getWorkspaceState() {
      return (await nested.workspace.state()) as Awaited<
        ReturnType<DesktopBridge['getWorkspaceState']>
      >;
    },
    async selectWorkspace(workspaceRoot) {
      return (await nested.workspace.select({
        workspaceRoot,
      })) as Awaited<ReturnType<DesktopBridge['selectWorkspace']>>;
    },
    async loginProfile(input) {
      return (await nested.auth.login(input)) as Awaited<
        ReturnType<DesktopBridge['loginProfile']>
      >;
    },
    async importBrowserProfile(input) {
      return (await nested.auth.importBrowser(input)) as Awaited<
        ReturnType<DesktopBridge['importBrowserProfile']>
      >;
    },
    async createProfile(input) {
      return (await nested.profiles.create(input)) as Awaited<
        ReturnType<DesktopBridge['createProfile']>
      >;
    },
    async activateProfile(profileId) {
      return (await nested.profiles.activate(profileId)) as Awaited<
        ReturnType<DesktopBridge['activateProfile']>
      >;
    },
    async deleteProfile(profileId) {
      return (await nested.profiles.delete(profileId)) as Awaited<
        ReturnType<DesktopBridge['deleteProfile']>
      >;
    },
    async getArchiveExplorerSummary(snapshotId) {
      return (await nested.archive.summary(
        snapshotId ? { snapshotId } : {},
      )) as Awaited<ReturnType<DesktopBridge['getArchiveExplorerSummary']>>;
    },
    async listArchiveExplorerRecords(input) {
      return (await nested.archive.list(input)) as Awaited<
        ReturnType<DesktopBridge['listArchiveExplorerRecords']>
      >;
    },
    async getArchiveExplorerRecord(input) {
      return (await nested.archive.detail(input)) as Awaited<
        ReturnType<DesktopBridge['getArchiveExplorerRecord']>
      >;
    },
    async getCoverageSummary(snapshotId) {
      return (await nested.coverage.summary(
        snapshotId ? { snapshotId } : {},
      )) as Awaited<ReturnType<DesktopBridge['getCoverageSummary']>>;
    },
    async listCoverageRecords(input) {
      return (await nested.coverage.list(input)) as Awaited<
        ReturnType<DesktopBridge['listCoverageRecords']>
      >;
    },
    async getCoverageRecord(input) {
      return (await nested.coverage.detail(input)) as Awaited<
        ReturnType<DesktopBridge['getCoverageRecord']>
      >;
    },
    async getCrawlStatus(snapshotId) {
      return (await nested.crawl.status(
        snapshotId ? { snapshotId } : {},
      )) as Awaited<ReturnType<DesktopBridge['getCrawlStatus']>>;
    },
    async listJobs() {
      return (await nested.jobs.list()) as Awaited<
        ReturnType<DesktopBridge['listJobs']>
      >;
    },
    async listJobEvents(jobId, limit) {
      return (await nested.jobs.events({
        jobId,
        limit,
      })) as Awaited<ReturnType<DesktopBridge['listJobEvents']>>;
    },
    async startJob(input) {
      return (await nested.jobs.start(input)) as Awaited<
        ReturnType<DesktopBridge['startJob']>
      >;
    },
    async pauseJob(jobId) {
      return (await nested.jobs.pause(jobId)) as Awaited<
        ReturnType<DesktopBridge['pauseJob']>
      >;
    },
    async resumeJob(jobId, options) {
      return (await nested.jobs.resume(jobId, options)) as Awaited<
        ReturnType<DesktopBridge['resumeJob']>
      >;
    },
    async startMirrorPreview(snapshotId, port) {
      return (await nested.mirror.startPreview({
        snapshotId,
        port,
      })) as Awaited<ReturnType<DesktopBridge['startMirrorPreview']>>;
    },
    async stopMirrorPreview(jobId) {
      return (await nested.mirror.stopPreview(jobId)) as Awaited<
        ReturnType<DesktopBridge['stopMirrorPreview']>
      >;
    },
    async openPath(path) {
      await nested.paths.open(path);
    },
    async openExternal(url) {
      await nested.external.open(url);
    },
    archive: {
      async getState() {
        return (await adapter.invoke('archive:state')) as Awaited<
          ReturnType<DesktopBridge['archive']['getState']>
        >;
      },
      async setManualOverride(absolutePath) {
        return (await adapter.invoke('archive:set-manual-override', {
          absolutePath,
        })) as Awaited<
          ReturnType<DesktopBridge['archive']['setManualOverride']>
        >;
      },
      async browseForRoot() {
        return (await adapter.invoke('archive:browse-for-root')) as Awaited<
          ReturnType<DesktopBridge['archive']['browseForRoot']>
        >;
      },
      onChanged(cb) {
        const unsubscribe = adapter.on('archive:changed', (...args) => {
          const payload = args[0] as Parameters<typeof cb>[0];
          cb(payload);
        });
        return unsubscribe ?? (() => undefined);
      },
    },
    theme: {
      async get() {
        return (await adapter.invoke('library:theme:get')) as Awaited<
          ReturnType<DesktopBridge['theme']['get']>
        >;
      },
      async set(preference) {
        return (await adapter.invoke('library:theme:set', {
          preference,
        })) as Awaited<ReturnType<DesktopBridge['theme']['set']>>;
      },
      onChanged(cb) {
        const unsubscribe = adapter.on('theme:changed', (...args) => {
          const payload = args[0] as Parameters<typeof cb>[0];
          cb(payload);
        });
        return unsubscribe ?? (() => undefined);
      },
    },
    library: {
      async listProblems(input) {
        return (await adapter.invoke('library:problems:list', input)) as Awaited<
          ReturnType<DesktopBridge['library']['listProblems']>
        >;
      },
      async listTags(input) {
        return (await adapter.invoke('library:tags', input)) as Awaited<
          ReturnType<DesktopBridge['library']['listTags']>
        >;
      },
      async getDetail(input) {
        return (await adapter.invoke(
          'library:problems:detail',
          input,
        )) as Awaited<ReturnType<DesktopBridge['library']['getDetail']>>;
      },
    },
    shell: {
      async openPath(path) {
        return (await adapter.invoke('shell:open-path', { path })) as Awaited<
          ReturnType<DesktopBridge['shell']['openPath']>
        >;
      },
      async copyToClipboard(text) {
        return (await adapter.invoke('shell:copy-to-clipboard', {
          text,
        })) as Awaited<ReturnType<DesktopBridge['shell']['copyToClipboard']>>;
      },
    },
    operator: {
      async runFullRefresh(input) {
        return (await adapter.invoke(
          'operator:run-full-refresh',
          input ?? {},
        )) as Awaited<
          ReturnType<DesktopBridge['operator']['runFullRefresh']>
        >;
      },
      async runFullRefreshCancel(input) {
        return (await adapter.invoke(
          'operator:run-full-refresh:cancel',
          input,
        )) as Awaited<
          ReturnType<DesktopBridge['operator']['runFullRefreshCancel']>
        >;
      },
      onProgress(cb) {
        const unsubscribe = adapter.on(
          'operator:run-full-refresh:progress',
          (...args) => {
            const payload = args[0] as Parameters<typeof cb>[0];
            cb(payload);
          },
        );
        return unsubscribe ?? (() => undefined);
      },
      async login(input) {
        return (await adapter.invoke(
          'operator:login',
          input,
        )) as Awaited<ReturnType<DesktopBridge['operator']['login']>>;
      },
      async openLiveSiteViewer(input) {
        return (await adapter.invoke(
          'operator:open-live-site-viewer',
          input ?? {},
        )) as Awaited<
          ReturnType<DesktopBridge['operator']['openLiveSiteViewer']>
        >;
      },
    },
  };
}
