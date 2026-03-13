import type {
  GuiCrawlMode,
  DesktopPreferencesRecord,
  GuiCrawlStatus,
  GuiJobEvent,
  GuiJobRecord,
  GuiProfileRecord,
  GuiVerbosityMode,
  GuiWorkspaceState,
} from './types.js';

export interface DesktopBridge {
  getDesktopPreferences: () => Promise<DesktopPreferencesRecord>;
  setVerbosityMode: (
    verbosityMode: GuiVerbosityMode,
  ) => Promise<DesktopPreferencesRecord>;
  getWorkspaceState: () => Promise<GuiWorkspaceState | null>;
  selectWorkspace: (workspaceRoot: string) => Promise<GuiWorkspaceState>;
  loginProfile: (input: {
    profileId: string;
    label: string;
    userHandle?: string;
    username: string;
    password: string;
    encryptedBundlePath?: string;
  }) => Promise<{
    profile: GuiProfileRecord;
    workspaceState: GuiWorkspaceState;
    job: GuiJobRecord;
  }>;
  importBrowserProfile: (input: {
    profileId: string;
    label: string;
    userHandle?: string;
    browser: 'edge' | 'chrome';
    profileName?: string;
    userDataDir?: string;
    encryptedBundlePath?: string;
  }) => Promise<{
    profile: GuiProfileRecord;
    workspaceState: GuiWorkspaceState;
    job: GuiJobRecord;
  }>;
  createProfile: (input: {
    profileId: string;
    label: string;
    userHandle?: string;
    provenance: GuiProfileRecord['provenance'];
    sessionCookies: Array<{
      key: string;
      value: string;
      domain?: string;
      path?: string;
      expires?: number | string;
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: string;
    }>;
    encryptedBundlePath?: string;
  }) => Promise<GuiProfileRecord>;
  activateProfile: (profileId: string) => Promise<GuiWorkspaceState>;
  deleteProfile: (profileId: string) => Promise<GuiWorkspaceState>;
  getCrawlStatus: (snapshotId?: string) => Promise<GuiCrawlStatus | null>;
  listJobs: () => Promise<GuiJobRecord[]>;
  listJobEvents: (jobId: string, limit?: number) => Promise<GuiJobEvent[]>;
  startJob: (input: {
    kind: 'crawl' | 'normalize' | 'rank' | 'mirror-build' | 'snapshot-finalize';
    snapshotId?: string;
    profileId?: string;
    detail?: {
      scope?: 'public' | 'user' | 'all';
      mode?: GuiCrawlMode;
      [key: string]: unknown;
    };
    maxIterations?: number;
  }) => Promise<GuiJobRecord>;
  pauseJob: (jobId: string) => Promise<GuiJobRecord>;
  resumeJob: (jobId: string, options?: { maxIterations?: number }) => Promise<GuiJobRecord>;
  startMirrorPreview: (snapshotId: string, port?: number) => Promise<{
    job: GuiJobRecord;
    baseUrl: string;
  }>;
  stopMirrorPreview: (jobId: string) => Promise<GuiJobRecord>;
  openExternal: (url: string) => Promise<void>;
}

export interface DesktopBridgeAdapter {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>;
  on: (
    channel: string,
    listener: (...args: unknown[]) => void,
  ) => (() => void) | void;
  off?: (channel: string) => void;
}
