import type { LoadedLocalConfig } from '../config/local-config.js';
import { loadLocalConfig } from '../config/local-config.js';
import { PbinfoAuthClient } from './pbinfo-auth.js';
import type { CredentialLoginResult } from './pbinfo-auth.js';
import { probePbinfoAuthStatus } from './auth-status.js';
import type { PbinfoAuthStatusResult } from './auth-status.js';
import { createEncryptedAuthBundle } from './auth-bundle.js';
import { persistSerializedCookies } from './session-store.js';

export type BootstrapStatus =
  | 'already-authenticated'
  | 'logged-in-fresh'
  | 'skipped-no-credentials'
  | 'login-failed';

export type CredentialsSource = 'env' | 'file' | 'none';

export interface BootstrapAuthClient {
  loginWithCredentials: (input: {
    username: string;
    password: string;
  }) => Promise<CredentialLoginResult>;
}

export interface BootstrapAuthOptions {
  workspaceRoot: string;
  env?: NodeJS.ProcessEnv;
  authClientFactory?: (config: LoadedLocalConfig) => BootstrapAuthClient;
  probe?: (config: LoadedLocalConfig) => Promise<PbinfoAuthStatusResult>;
  sealBundle?: (options: {
    workspaceRoot: string;
  }) => Promise<{ bundlePath: string } | unknown>;
  now?: Date;
}

export interface BootstrapAuthResult {
  status: BootstrapStatus;
  credentialsSource: CredentialsSource;
  resolvedHandle?: string;
  configuredHandle?: string;
  sealedBundle: boolean;
  failureReason?: string;
  checkedAt: string;
}

interface ResolvedCredentials {
  source: CredentialsSource;
  username?: string;
  password?: string;
}

export async function bootstrapAuth(
  options: BootstrapAuthOptions,
): Promise<BootstrapAuthResult> {
  const config = loadLocalConfig(options.workspaceRoot);
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const checkedAt = now.toISOString();
  const configuredHandle = config.crawl.userHandle;

  const credentials = resolveCredentials(env, config);
  const probe = options.probe ?? probePbinfoAuthStatus;
  const probeResult = await probe(config).catch(() => undefined);

  if (probeResult?.status === 'ok') {
    return {
      status: 'already-authenticated',
      credentialsSource: credentials.source,
      resolvedHandle: probeResult.resolvedHandle,
      configuredHandle,
      sealedBundle: false,
      checkedAt,
    };
  }

  if (credentials.source === 'none') {
    return {
      status: 'skipped-no-credentials',
      credentialsSource: 'none',
      configuredHandle,
      sealedBundle: false,
      failureReason:
        'No PBInfo credentials found. Set PBINFO_USERNAME and PBINFO_PASSWORD environment variables, or populate .local/pbinfo.local.json with auth.strategy="credentials".',
      checkedAt,
    };
  }

  const authClient = (options.authClientFactory ?? defaultAuthClientFactory)(config);
  const loginResult = await authClient.loginWithCredentials({
    username: credentials.username!,
    password: credentials.password!,
  });

  if (!loginResult.success) {
    return {
      status: 'login-failed',
      credentialsSource: credentials.source,
      configuredHandle,
      resolvedHandle: loginResult.resolvedHandle,
      sealedBundle: false,
      failureReason:
        loginResult.failureReason
        ?? 'PBInfo credential login did not create an authenticated session.',
      checkedAt,
    };
  }

  if (loginResult.sessionCookies && loginResult.sessionCookies.length > 0) {
    try {
      persistSerializedCookies(config.auth.sessionCookiesPath, loginResult.sessionCookies);
    } catch {
      // The PbinfoAuthClient default behavior also persists cookies on successful login,
      // so a failure here is non-fatal for the caller.
    }
  }

  let sealedBundle = false;
  try {
    const sealer = options.sealBundle ?? createEncryptedAuthBundle;
    await sealer({ workspaceRoot: options.workspaceRoot });
    sealedBundle = true;
  } catch {
    // Failing to seal the encrypted bundle is non-fatal — the session cookies are already
    // persisted and the operator can retry `secrets bootstrap` manually.
  }

  return {
    status: 'logged-in-fresh',
    credentialsSource: credentials.source,
    resolvedHandle: loginResult.resolvedHandle,
    configuredHandle,
    sealedBundle,
    checkedAt,
  };
}

function resolveCredentials(
  env: NodeJS.ProcessEnv,
  config: LoadedLocalConfig,
): ResolvedCredentials {
  const envUsername = env.PBINFO_USERNAME;
  const envPassword = env.PBINFO_PASSWORD;
  if (envUsername && envPassword) {
    return { source: 'env', username: envUsername, password: envPassword };
  }

  if (
    config.auth.strategy === 'credentials'
    && config.auth.username
    && config.auth.password
  ) {
    return {
      source: 'file',
      username: config.auth.username,
      password: config.auth.password,
    };
  }

  return { source: 'none' };
}

function defaultAuthClientFactory(config: LoadedLocalConfig): BootstrapAuthClient {
  return new PbinfoAuthClient({
    baseUrl: 'https://www.pbinfo.ro/',
    sessionCookiesPath: config.auth.sessionCookiesPath,
  });
}
