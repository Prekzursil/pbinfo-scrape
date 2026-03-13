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

export function loadLocalConfig(workspaceRoot: string): LoadedLocalConfig {
  const resolvedWorkspace = resolve(workspaceRoot);
  const defaultLocalRoot = join(resolvedWorkspace, '.local');
  const configPath = join(defaultLocalRoot, 'pbinfo.local.json');
  const parsedInput = existsSync(configPath)
    ? configSchema.parse(JSON.parse(readFileSync(configPath, 'utf8')))
    : undefined;

  const localRoot = resolveRelativeRoot(
    resolvedWorkspace,
    parsedInput?.paths?.localRoot ?? '.local',
  );
  const outputRoot = resolveRelativeRoot(
    resolvedWorkspace,
    parsedInput?.paths?.outputRoot ?? 'output',
  );
  const archiveRoot = resolveRelativeRoot(
    resolvedWorkspace,
    parsedInput?.paths?.archiveRoot ?? 'archive',
  );
  const artifactsRoot = resolveRelativeRoot(
    resolvedWorkspace,
    parsedInput?.paths?.artifactsRoot ?? join('output', 'artifacts'),
  );

  return {
    auth: {
      strategy: parsedInput?.auth?.strategy ?? 'none',
      username: parsedInput?.auth?.username,
      password: parsedInput?.auth?.password,
      cookieSourcePath: parsedInput?.auth?.cookieSourcePath
        ? resolveRelativeRoot(resolvedWorkspace, parsedInput.auth.cookieSourcePath)
        : undefined,
      sessionCookiesPath: parsedInput?.auth?.sessionCookiesPath
        ? resolveRelativeRoot(resolvedWorkspace, parsedInput.auth.sessionCookiesPath)
        : join(localRoot, 'session-cookies.json'),
    },
    paths: {
      workspaceRoot: resolvedWorkspace,
      localRoot,
      outputRoot,
      archiveRoot,
      snapshotsRoot: join(archiveRoot, 'snapshots'),
      artifactsRoot,
    },
    crawl: {
      maxConcurrency: parsedInput?.crawl?.maxConcurrency ?? 2,
      retryDelayMs: parsedInput?.crawl?.retryDelayMs ?? 60_000,
      crossCheckWithBrowser: parsedInput?.crawl?.crossCheckWithBrowser ?? true,
      userHandle: parsedInput?.crawl?.userHandle,
      publicStartUrls:
        parsedInput?.crawl?.publicStartUrls ?? defaultPublicStartUrls(),
    },
    mirror: {
      blockedAssetHosts:
        parsedInput?.mirror?.blockedAssetHosts ?? defaultBlockedAssetHosts(),
      externalAssetHosts:
        parsedInput?.mirror?.externalAssetHosts ?? defaultExternalAssetHosts(),
    },
    secrets: {
      recipient: parsedInput?.secrets?.recipient,
      identityPath: parsedInput?.secrets?.identityPath
        ? resolveRelativeRoot(resolvedWorkspace, parsedInput.secrets.identityPath)
        : join(localRoot, 'age-identity.txt'),
      recipientPath: parsedInput?.secrets?.recipientPath
        ? resolveRelativeRoot(resolvedWorkspace, parsedInput.secrets.recipientPath)
        : join(archiveRoot, 'secrets', 'age-recipient.txt'),
      bundlePath: parsedInput?.secrets?.bundlePath
        ? resolveRelativeRoot(resolvedWorkspace, parsedInput.secrets.bundlePath)
        : join(archiveRoot, 'secrets', 'pbinfo-auth.age'),
    },
    artifacts: {
      exportRoot: parsedInput?.artifacts?.exportRoot
        ? resolveRelativeRoot(resolvedWorkspace, parsedInput.artifacts.exportRoot)
        : join(artifactsRoot, 'exports'),
    },
    ranking: {
      overridesPath: parsedInput?.ranking?.overridesPath
        ? resolveRelativeRoot(resolvedWorkspace, parsedInput.ranking.overridesPath)
        : join(localRoot, 'ranking-overrides.json'),
    },
    publish: {
      owner: parsedInput?.publish?.owner ?? 'Prekzursil',
      repo: parsedInput?.publish?.repo ?? 'pbinfo-scrape',
    },
  };
}

function resolveRelativeRoot(workspaceRoot: string, inputPath: string): string {
  return resolve(workspaceRoot, inputPath);
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
  return [
    'ajax.googleapis.com',
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
    'use.fontawesome.com',
  ];
}

function defaultBlockedAssetHosts(): string[] {
  return [
    'www.googletagmanager.com',
    'pagead2.googlesyndication.com',
    'googleads.g.doubleclick.net',
  ];
}
