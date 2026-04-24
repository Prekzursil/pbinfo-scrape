import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { bootstrapAuth } from '../../auth/bootstrap.js';

export interface OperatorLoginInput {
  readonly username: string;
  readonly password: string;
}

export interface OperatorLoginResult {
  readonly success: boolean;
  readonly resolvedHandle?: string;
  readonly status: string;
}

export async function operatorLogin(
  archiveRoot: string,
  input: OperatorLoginInput,
): Promise<OperatorLoginResult> {
  const workspaceRoot = dirname(archiveRoot);
  writeLocalCredentials(workspaceRoot, input);
  const result = await bootstrapAuth({ workspaceRoot });
  return {
    success:
      result.status === 'already-authenticated' ||
      result.status === 'logged-in-fresh',
    resolvedHandle: result.resolvedHandle,
    status: result.status,
  };
}

function writeLocalCredentials(
  workspaceRoot: string,
  creds: OperatorLoginInput,
): void {
  const localDir = join(workspaceRoot, '.local');
  const configPath = join(localDir, 'pbinfo.local.json');
  mkdirSync(localDir, { recursive: true });

  let existing: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
      if (parsed && typeof parsed === 'object') {
        existing = parsed as Record<string, unknown>;
      }
    } catch {
      existing = {};
    }
  }

  const auth =
    existing.auth && typeof existing.auth === 'object'
      ? (existing.auth as Record<string, unknown>)
      : {};
  const next = {
    ...existing,
    auth: {
      ...auth,
      strategy: 'credentials',
      username: creds.username,
      password: creds.password,
    },
  };

  writeFileSync(configPath, JSON.stringify(next, null, 2), 'utf8');
  // NOTE: intentionally no logging here. Any error surfacing to callers must
  // NOT include the raw password — the caller's catch re-throws a generic
  // 'login-failed' error.
}

export function credentialsPathFor(archiveRoot: string): string {
  return join(dirname(archiveRoot), '.local', 'pbinfo.local.json');
}
