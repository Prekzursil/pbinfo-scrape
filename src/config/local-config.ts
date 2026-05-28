import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { z } from 'zod';

const configSchema = z.object({
  auth: z
    .object({
      strategy: z.enum(['none', 'credentials', 'cookie-import']).optional(),
      username: z.string().min(1).optional(),
      password: z.string().min(1).optional(),
      cookieSourcePath: z.string().min(1).optional(),
      sessionCookiesPath: z.string().min(1).optional(),
    })
    .partial()
    .optional(),
  paths: z
    .object({
      outputRoot: z.string().min(1).optional(),
      localRoot: z.string().min(1).optional(),
      archiveRoot: z.string().min(1).optional(),
      artifactsRoot: z.string().min(1).optional(),
    })
    .partial()
    .optional(),
  crawl: z
    .object({
      maxConcurrency: z.number().int().positive().optional(),
      retryDelayMs: z.number().int().positive().optional(),
      requestTimeoutMs: z.number().int().positive().optional(),
      crossCheckWithBrowser: z.boolean().optional(),
      userHandle: z.string().min(1).optional(),
      publicStartUrls: z.array(z.string().url()).optional(),
    })
    .partial()
    .optional(),
  mirror: z
    .object({
      blockedAssetHosts: z.array(z.string().min(1)).optional(),
      externalAssetHosts: z.array(z.string().min(1)).optional(),
    })
    .partial()
    .optional(),
  secrets: z
    .object({
      recipient: z.string().min(1).optional(),
      identityPath: z.string().min(1).optional(),
      recipientPath: z.string().min(1).optional(),
      bundlePath: z.string().min(1).optional(),
    })
    .partial()
    .optional(),
  artifacts: z
    .object({
      exportRoot: z.string().min(1).optional(),
    })
    .partial()
    .optional(),
  ranking: z
    .object({
      overridesPath: z.string().min(1).optional(),
    })
    .partial()
    .optional(),
  publish: z
    .object({
      owner: z.string().min(1).optional(),
      repo: z.string().min(1).optional(),
    })
    .partial()
    .optional(),
});

export interface LoadedLocalConfig {
  auth: {
    strategy: 'none' | 'credentials' | 'cookie-import';
    username?: string;
    password?: string;
    cookieSourcePath?: string;
    sessionCookiesPath: string;
  };
  paths: {
    workspaceRoot: string;
    localRoot: string;
    outputRoot: string;
    archiveRoot: string;
    snapshotsRoot: string;
    artifactsRoot: string;
  };
  crawl: {
    maxConcurrency: number;
    retryDelayMs: number;
    requestTimeoutMs: number;
    crossCheckWithBrowser: boolean;
    userHandle?: string;
    publicStartUrls: string[];
  };
  mirror: {
    blockedAssetHosts: string[];
    externalAssetHosts: string[];
  };
  secrets: {
    recipient?: string;
    identityPath: string;
    recipientPath: string;
    bundlePath: string;
  };
  artifacts: {
    exportRoot: string;
  };
  ranking: {
    overridesPath: string;
  };
  publish: {
    owner: string;
    repo: string;
  };
}

type ParsedConfig = z.infer<typeof configSchema>;

interface ResolvedRoots {
  localRoot: string;
  outputRoot: string;
  archiveRoot: string;
  artifactsRoot: string;
}

function loadParsedConfig(workspaceRoot: string): ParsedConfig | undefined {
  const configPath = join(workspaceRoot, '.local', 'pbinfo.local.json');
  return existsSync(configPath)
    ? configSchema.parse(JSON.parse(readFileSync(configPath, 'utf8')))
    : undefined;
}

function resolveRoots(workspaceRoot: string, parsed: ParsedConfig | undefined): ResolvedRoots {
  const paths = parsed?.paths ?? {};
  return {
    localRoot: resolveRelativeRoot(workspaceRoot, paths.localRoot ?? '.local'),
    outputRoot: resolveRelativeRoot(workspaceRoot, paths.outputRoot ?? 'output'),
    archiveRoot: resolveRelativeRoot(workspaceRoot, paths.archiveRoot ?? 'archive'),
    artifactsRoot: resolveRelativeRoot(
      workspaceRoot,
      paths.artifactsRoot ?? join('output', 'artifacts'),
    ),
  };
}

function buildAuthConfig(
  workspaceRoot: string,
  parsed: ParsedConfig | undefined,
  roots: ResolvedRoots,
): LoadedLocalConfig['auth'] {
  const auth = parsed?.auth ?? {};
  return {
    strategy: auth.strategy ?? 'none',
    username: auth.username,
    password: auth.password,
    cookieSourcePath: resolveOptionalPath(workspaceRoot, auth.cookieSourcePath),
    sessionCookiesPath: resolvePathOrDefault(
      workspaceRoot,
      auth.sessionCookiesPath,
      join(roots.localRoot, 'session-cookies.json'),
    ),
  };
}

function buildCrawlConfig(parsed: ParsedConfig | undefined): LoadedLocalConfig['crawl'] {
  const crawl = parsed?.crawl ?? {};
  return {
    maxConcurrency: crawl.maxConcurrency ?? 2,
    retryDelayMs: crawl.retryDelayMs ?? 60_000,
    requestTimeoutMs: crawl.requestTimeoutMs ?? 30_000,
    crossCheckWithBrowser: crawl.crossCheckWithBrowser ?? true,
    userHandle: crawl.userHandle,
    publicStartUrls: crawl.publicStartUrls ?? defaultPublicStartUrls(),
  };
}

function buildSecretsConfig(
  workspaceRoot: string,
  parsed: ParsedConfig | undefined,
  roots: ResolvedRoots,
): LoadedLocalConfig['secrets'] {
  const secrets = parsed?.secrets ?? {};
  return {
    recipient: secrets.recipient,
    identityPath: resolvePathOrDefault(
      workspaceRoot,
      secrets.identityPath,
      join(roots.localRoot, 'age-identity.txt'),
    ),
    recipientPath: resolvePathOrDefault(
      workspaceRoot,
      secrets.recipientPath,
      join(roots.archiveRoot, 'secrets', 'age-recipient.txt'),
    ),
    bundlePath: resolvePathOrDefault(
      workspaceRoot,
      secrets.bundlePath,
      join(roots.archiveRoot, 'secrets', 'pbinfo-auth.age'),
    ),
  };
}

export function loadLocalConfig(workspaceRoot: string): LoadedLocalConfig {
  const resolvedWorkspace = resolve(workspaceRoot);
  const parsedInput = loadParsedConfig(resolvedWorkspace);
  const roots = resolveRoots(resolvedWorkspace, parsedInput);

  return {
    auth: buildAuthConfig(resolvedWorkspace, parsedInput, roots),
    paths: {
      workspaceRoot: resolvedWorkspace,
      localRoot: roots.localRoot,
      outputRoot: roots.outputRoot,
      archiveRoot: roots.archiveRoot,
      snapshotsRoot: join(roots.archiveRoot, 'snapshots'),
      artifactsRoot: roots.artifactsRoot,
    },
    crawl: buildCrawlConfig(parsedInput),
    mirror: buildMirrorConfig(parsedInput),
    secrets: buildSecretsConfig(resolvedWorkspace, parsedInput, roots),
    artifacts: {
      exportRoot: resolvePathOrDefault(
        resolvedWorkspace,
        parsedInput?.artifacts?.exportRoot,
        join(roots.artifactsRoot, 'exports'),
      ),
    },
    ranking: {
      overridesPath: resolvePathOrDefault(
        resolvedWorkspace,
        parsedInput?.ranking?.overridesPath,
        join(roots.localRoot, 'ranking-overrides.json'),
      ),
    },
    publish: buildPublishConfig(parsedInput),
  };
}

function buildMirrorConfig(parsed: ParsedConfig | undefined): LoadedLocalConfig['mirror'] {
  const mirror = parsed?.mirror ?? {};
  return {
    blockedAssetHosts: mirror.blockedAssetHosts ?? defaultBlockedAssetHosts(),
    externalAssetHosts: mirror.externalAssetHosts ?? defaultExternalAssetHosts(),
  };
}

function buildPublishConfig(parsed: ParsedConfig | undefined): LoadedLocalConfig['publish'] {
  const publish = parsed?.publish ?? {};
  return {
    owner: publish.owner ?? 'Prekzursil',
    repo: publish.repo ?? 'pbinfo-scrape',
  };
}

function resolveRelativeRoot(workspaceRoot: string, inputPath: string): string {
  return resolve(workspaceRoot, inputPath);
}

function resolveOptionalPath(
  workspaceRoot: string,
  inputPath: string | undefined,
): string | undefined {
  return inputPath ? resolveRelativeRoot(workspaceRoot, inputPath) : undefined;
}

function resolvePathOrDefault(
  workspaceRoot: string,
  inputPath: string | undefined,
  fallback: string,
): string {
  return inputPath ? resolveRelativeRoot(workspaceRoot, inputPath) : fallback;
}

function defaultPublicStartUrls(): string[] {
  return [
    'https://www.pbinfo.ro/',
    'https://www.pbinfo.ro/probleme',
    'https://www.pbinfo.ro/probleme-categorii/9',
    'https://www.pbinfo.ro/probleme-categorii/10',
    'https://www.pbinfo.ro/probleme-categorii/11',
  ];
}

function defaultExternalAssetHosts(): string[] {
  return ['ajax.googleapis.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'use.fontawesome.com'];
}

function defaultBlockedAssetHosts(): string[] {
  return [
    'www.googletagmanager.com',
    'pagead2.googlesyndication.com',
    'googleads.g.doubleclick.net',
  ];
}
