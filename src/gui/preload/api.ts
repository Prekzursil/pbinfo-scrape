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
    async openExternal(url) {
      await nested.external.open(url);
    },
  };
}
