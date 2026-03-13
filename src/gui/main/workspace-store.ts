import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { createProfileInputSchema } from '../shared/contracts.js';
import {
  type GuiProfileRecord,
  type GuiWorkspaceState,
  guiWorkspaceStateSchema,
} from '../shared/types.js';

interface TimedOptions {
  now?: Date;
}

interface UpsertWorkspaceProfileInput
  extends ReturnType<typeof createProfileInputSchema.parse> {
  now?: Date;
}

interface WorkspaceLocalConfigShape {
  auth?: Record<string, unknown>;
  crawl?: Record<string, unknown>;
  [key: string]: unknown;
}

export function initializeWorkspaceState(
  workspaceRoot: string,
  options: TimedOptions = {},
): GuiWorkspaceState {
  const resolvedWorkspace = resolve(workspaceRoot);
  if (existsSync(getWorkspaceStatePath(resolvedWorkspace))) {
    return readWorkspaceState(resolvedWorkspace);
  }

  const timestamp = iso(options.now);
  const state: GuiWorkspaceState = {
    version: 1,
    workspaceRoot: resolvedWorkspace,
    profiles: [],
    notifications: {
      desktopBanners: true,
      windowsToast: true,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  writeWorkspaceState(resolvedWorkspace, state);
  return state;
}

export function readWorkspaceState(workspaceRoot: string): GuiWorkspaceState {
  const resolvedWorkspace = resolve(workspaceRoot);
  const statePath = getWorkspaceStatePath(resolvedWorkspace);
  if (!existsSync(statePath)) {
    return initializeWorkspaceState(resolvedWorkspace);
  }

  return guiWorkspaceStateSchema.parse(
    JSON.parse(readFileSync(statePath, 'utf8')),
  );
}

export function upsertWorkspaceProfile(
  workspaceRoot: string,
  input: UpsertWorkspaceProfileInput,
): GuiProfileRecord {
  const resolvedWorkspace = resolve(workspaceRoot);
  const { now, ...profileInput } = input;
  const parsed = createProfileInputSchema.parse(profileInput);
  const state = readWorkspaceState(resolvedWorkspace);
  const existing = state.profiles.find(
    (profile) => profile.profileId === parsed.profileId,
  );
  const timestamp = iso(now);
  const cookiesPath = getProfileCookiesPath(resolvedWorkspace, parsed.profileId);
  mkdirSync(dirname(cookiesPath), { recursive: true });
  writeFileSync(cookiesPath, JSON.stringify(parsed.sessionCookies, null, 2), 'utf8');

  const record: GuiProfileRecord = {
    profileId: parsed.profileId,
    label: parsed.label,
    userHandle: parsed.userHandle,
    provenance: parsed.provenance,
    sessionCookiesPath: toWorkspaceRelativePath(resolvedWorkspace, cookiesPath),
    encryptedBundlePath: parsed.encryptedBundlePath,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };

  const profiles = existing
    ? state.profiles.map((profile) =>
        profile.profileId === record.profileId ? record : profile,
      )
    : [...state.profiles, record];
  const nextState: GuiWorkspaceState = {
    ...state,
    profiles,
    updatedAt: timestamp,
  };
  writeWorkspaceState(resolvedWorkspace, nextState);
  return record;
}

export function upsertAndActivateWorkspaceProfile(
  workspaceRoot: string,
  input: UpsertWorkspaceProfileInput,
): {
  profile: GuiProfileRecord;
  workspaceState: GuiWorkspaceState;
} {
  const profile = upsertWorkspaceProfile(workspaceRoot, input);
  const workspaceState = activateWorkspaceProfile(workspaceRoot, profile.profileId, {
    now: input.now,
  });

  return {
    profile,
    workspaceState,
  };
}

export function activateWorkspaceProfile(
  workspaceRoot: string,
  profileId: string,
  options: TimedOptions = {},
): GuiWorkspaceState {
  const resolvedWorkspace = resolve(workspaceRoot);
  const state = readWorkspaceState(resolvedWorkspace);
  const profile = state.profiles.find((entry) => entry.profileId === profileId);
  if (!profile) {
    throw new Error(`Workspace profile "${profileId}" was not found.`);
  }

  const activeCookiesPath = getActiveSessionCookiesPath(resolvedWorkspace);
  mkdirSync(dirname(activeCookiesPath), { recursive: true });
  writeFileSync(
    activeCookiesPath,
    readFileSync(resolve(resolvedWorkspace, profile.sessionCookiesPath), 'utf8'),
    'utf8',
  );

  const localConfig = readRawLocalConfig(resolvedWorkspace);
  const nextConfig: WorkspaceLocalConfigShape = {
    ...localConfig,
    auth: {
      ...omitKeys(localConfig.auth, ['username', 'password', 'cookieSourcePath']),
      strategy: 'cookie-import',
      sessionCookiesPath: '.local/session-cookies.json',
    },
    crawl: {
      ...localConfig.crawl,
      ...(profile.userHandle ? { userHandle: profile.userHandle } : {}),
    },
  };
  writeRawLocalConfig(resolvedWorkspace, nextConfig);

  const nextState: GuiWorkspaceState = {
    ...state,
    activeProfileId: profileId,
    updatedAt: iso(options.now),
  };
  writeWorkspaceState(resolvedWorkspace, nextState);
  return nextState;
}

export function deleteWorkspaceProfile(
  workspaceRoot: string,
  profileId: string,
  options: TimedOptions = {},
): GuiWorkspaceState {
  const resolvedWorkspace = resolve(workspaceRoot);
  const state = readWorkspaceState(resolvedWorkspace);
  const profile = state.profiles.find((entry) => entry.profileId === profileId);
  if (!profile) {
    return state;
  }

  rmSync(resolve(resolvedWorkspace, profile.sessionCookiesPath), { force: true });

  const isActive = state.activeProfileId === profileId;
  if (isActive) {
    rmSync(getActiveSessionCookiesPath(resolvedWorkspace), { force: true });
    const localConfig = readRawLocalConfig(resolvedWorkspace);
    const nextAuth = omitKeys(localConfig.auth, [
      'strategy',
      'sessionCookiesPath',
      'username',
      'password',
      'cookieSourcePath',
    ]);
    const nextCrawl = omitUserHandle(localConfig.crawl, profile.userHandle);
    const nextConfig: WorkspaceLocalConfigShape = {
      ...localConfig,
      ...(Object.keys(nextAuth).length > 0 ? { auth: nextAuth } : { auth: undefined }),
      ...(Object.keys(nextCrawl).length > 0 ? { crawl: nextCrawl } : { crawl: undefined }),
    };
    writeRawLocalConfig(resolvedWorkspace, nextConfig);
  }

  const nextState: GuiWorkspaceState = {
    ...state,
    profiles: state.profiles.filter((entry) => entry.profileId !== profileId),
    activeProfileId: isActive ? undefined : state.activeProfileId,
    updatedAt: iso(options.now),
  };
  writeWorkspaceState(resolvedWorkspace, nextState);
  return nextState;
}

function writeWorkspaceState(
  workspaceRoot: string,
  state: GuiWorkspaceState,
): void {
  const statePath = getWorkspaceStatePath(workspaceRoot);
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
}

function readRawLocalConfig(workspaceRoot: string): WorkspaceLocalConfigShape {
  const configPath = getRawLocalConfigPath(workspaceRoot);
  if (!existsSync(configPath)) {
    return {};
  }

  return JSON.parse(readFileSync(configPath, 'utf8')) as WorkspaceLocalConfigShape;
}

function writeRawLocalConfig(
  workspaceRoot: string,
  config: WorkspaceLocalConfigShape,
): void {
  const configPath = getRawLocalConfigPath(workspaceRoot);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify(stripUndefined(config), null, 2),
    'utf8',
  );
}

function getWorkspaceStatePath(workspaceRoot: string): string {
  return join(workspaceRoot, '.local', 'gui', 'workspace-state.json');
}

function getProfileCookiesPath(workspaceRoot: string, profileId: string): string {
  return join(workspaceRoot, '.local', 'gui', 'profiles', profileId, 'session-cookies.json');
}

function getActiveSessionCookiesPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.local', 'session-cookies.json');
}

function getRawLocalConfigPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.local', 'pbinfo.local.json');
}

function toWorkspaceRelativePath(workspaceRoot: string, targetPath: string): string {
  return relative(workspaceRoot, targetPath).replaceAll('\\', '/');
}

function iso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

function omitKeys(
  value: Record<string, unknown> | undefined,
  keys: string[],
): Record<string, unknown> {
  if (!value) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key)),
  );
}

function omitUserHandle(
  value: Record<string, unknown> | undefined,
  userHandle?: string,
): Record<string, unknown> {
  if (!value) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, currentValue]) =>
        key !== 'userHandle' || (userHandle !== undefined && currentValue !== userHandle),
    ),
  );
}

function stripUndefined<T>(input: T): T {
  if (Array.isArray(input)) {
    return input.map((entry) => stripUndefined(entry)) as T;
  }
  if (input && typeof input === 'object') {
    return Object.fromEntries(
      Object.entries(input)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, stripUndefined(value)]),
    ) as T;
  }
  return input;
}
