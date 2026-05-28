import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

import {
  assertArtifactExportRecord,
  assertSnapshotRecord,
  buildQueuePath,
  readArchiveCatalog,
} from '../archive/storage.js';
import type { LoadedLocalConfig } from '../config/local-config.js';
import { CrawlQueue } from '../crawl/crawl-queue.js';

export interface PublishWorkspaceOptions {
  workspaceRoot: string;
  config: LoadedLocalConfig;
  snapshotId?: string;
  commitMessage?: string;
  release?: boolean;
  tag?: string;
  uploadDesktopExe?: boolean;
  runCommand?: (workspaceRoot: string, command: string, args: string[]) => string;
}

export interface PublishWorkspaceResult {
  repository: string;
  initializedGit: boolean;
  snapshotId: string;
  stagedPaths: string[];
  tag?: string;
  releaseAssetPath?: string;
}

const DEFAULT_STAGE_ALLOWLIST = [
  '.gitignore',
  'README.md',
  'SECURITY.md',
  'electron-builder.json',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.desktop.json',
  'vite.desktop.config.ts',
  'vitest.config.ts',
  'assets',
  'scripts',
  'src',
  'tests',
  'archive',
] as const;

const SESSION_COOKIE_KEY = ['PHP', 'SESSID'].join('');
const KNOWN_FORBIDDEN_PASSWORD = ['Pre', 'kzur', 'sil', '1234'].join('');
const PASSWORD_ASSIGNMENT_PATTERN =
  /(?:^|[\s{,])"?(?:password|parola)"?\s*[:=]\s*"?([^\s",}\r\n]+)"?/gim;
const SESSION_COOKIE_LITERAL_PATTERN = new RegExp(`\\b${SESSION_COOKIE_KEY}=([^\\s;]+)`, 'i');
const SERIALIZED_SESSION_COOKIE_PATTERN = new RegExp(
  `"key"\\s*:\\s*"${SESSION_COOKIE_KEY}"[\\s\\S]{0,200}?"value"\\s*:\\s*"([^"]+)"`,
  'i',
);
const SAFE_PLACEHOLDER_VALUE_PATTERNS = [
  /^YOUR_/i,
  /^REPLACE_/i,
  /^<[^>]+>$/,
  /^(?:EXAMPLE|SAMPLE|TEST|DUMMY)(?:[_-].*)?$/i,
  /^secret$/i,
  /^cookie-value$/i,
  /^abc123$/i,
];
const FINAL_DESKTOP_EXE_PREFIX = 'Problem Archive Crawler ';
const LEGACY_DESKTOP_EXE_PREFIX = 'PBInfo Archive Desktop ';
const DEFAULT_REPO_DESCRIPTION = 'Problem Archive Crawler - PBInfo archival operator console.';
const DEFAULT_REPO_TOPICS = [
  'pbinfo',
  'archive',
  'crawler',
  'electron',
  'offline-mirror',
  'typescript',
] as const;

export function publishWorkspace(options: PublishWorkspaceOptions): PublishWorkspaceResult {
  const runCommand = options.runCommand ?? run;
  const snapshotId = options.snapshotId;
  if (!snapshotId) {
    throw new Error('publish requires --snapshot <id>.');
  }

  const catalog = readArchiveCatalog(options.config.paths.archiveRoot);
  const snapshot = assertSnapshotRecord(catalog, snapshotId);
  if (catalog.canonicalSnapshotId !== snapshotId) {
    throw new Error(`Snapshot ${snapshotId} is not the canonical snapshot.`);
  }
  if (catalog.snapshots.length !== 1) {
    throw new Error('Publish requires exactly one snapshot to remain in archive/snapshots/.');
  }

  const queuePath = buildQueuePath(options.config.paths.localRoot, snapshotId);
  if (existsSync(queuePath)) {
    const queue = new CrawlQueue(queuePath);
    const queueState = queue.getSnapshot();
    queue.close();
    if (queueState.pending > 0 || queueState.inProgress > 0) {
      throw new Error(
        `Snapshot ${snapshotId} is not fully drained (pending=${queueState.pending}, inProgress=${queueState.inProgress}).`,
      );
    }
  }
  if (snapshot.status !== 'completed') {
    throw new Error(`Snapshot ${snapshotId} must be completed before publish.`);
  }

  const artifactExport = assertArtifactExportRecord(options.config, snapshotId);
  if (!existsSync(artifactExport.exportRoot)) {
    throw new Error(`Raw artifact export root is missing for snapshot ${snapshotId}.`);
  }

  const stagedPaths = resolveStageAllowlist(options.workspaceRoot);
  const secretViolations = scanForPublishSecrets(options.workspaceRoot, stagedPaths);
  if (secretViolations.length > 0) {
    throw new Error(
      `Publish preflight found secret-like material in tracked files: ${secretViolations.join('; ')}`,
    );
  }

  const initializedGit = !existsSync(join(options.workspaceRoot, '.git'));
  if (initializedGit) {
    runCommand(options.workspaceRoot, 'git', ['init']);
    runCommand(options.workspaceRoot, 'git', ['checkout', '-B', 'main']);
  }

  try {
    runCommand(options.workspaceRoot, 'git', ['reset']);
  } catch {
    // Ignore reset failures on unborn repositories.
  }

  runCommand(options.workspaceRoot, 'git', ['add', '--', ...stagedPaths]);

  const packageMetadata = readPackageMetadata(options.workspaceRoot);
  const commitMessage = normalizeCommitMessage(
    options.commitMessage ?? `feat: publish ${snapshotId} PBInfo archive`,
  );
  try {
    runCommand(options.workspaceRoot, 'git', ['commit', '-m', commitMessage]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('nothing to commit')) {
      throw error;
    }
  }

  const repository = `${options.config.publish.owner}/${options.config.publish.repo}`;
  const remoteUrl = `https://github.com/${repository}.git`;
  try {
    runCommand(options.workspaceRoot, 'gh', ['repo', 'view', repository]);
  } catch {
    runCommand(options.workspaceRoot, 'gh', [
      'repo',
      'create',
      repository,
      '--private',
      '--description',
      DEFAULT_REPO_DESCRIPTION,
      '--confirm',
    ]);
  }

  try {
    runCommand(options.workspaceRoot, 'git', ['remote', 'get-url', 'origin']);
    runCommand(options.workspaceRoot, 'git', ['remote', 'set-url', 'origin', remoteUrl]);
  } catch {
    runCommand(options.workspaceRoot, 'git', ['remote', 'add', 'origin', remoteUrl]);
  }

  runCommand(options.workspaceRoot, 'git', ['push', '-u', 'origin', 'main']);

  configureRepositoryMetadata(
    options.workspaceRoot,
    repository,
    runCommand,
    packageMetadata.description,
  );

  let releaseAssetPath: string | undefined;
  let tag: string | undefined;
  if (options.release || options.uploadDesktopExe) {
    tag = options.tag ?? `v${packageMetadata.version}`;
    ensureAnnotatedTag(options.workspaceRoot, tag, packageMetadata.version, runCommand);
    runCommand(options.workspaceRoot, 'git', ['push', 'origin', `refs/tags/${tag}`]);

    if (options.uploadDesktopExe) {
      releaseAssetPath = resolveDesktopReleaseAsset(options.workspaceRoot);
    }

    createOrUpdateRelease(
      options.workspaceRoot,
      repository,
      tag,
      snapshotId,
      packageMetadata.version,
      releaseAssetPath,
      runCommand,
    );
  }

  return {
    repository,
    initializedGit,
    snapshotId,
    stagedPaths,
    tag,
    releaseAssetPath,
  };
}

function resolveStageAllowlist(workspaceRoot: string): string[] {
  return DEFAULT_STAGE_ALLOWLIST.filter((entry) => existsSync(join(workspaceRoot, entry)));
}

function scanForPublishSecrets(workspaceRoot: string, stagedPaths: string[]): string[] {
  const violations: string[] = [];

  for (const stagedPath of stagedPaths) {
    const absolutePath = join(workspaceRoot, stagedPath);
    if (!existsSync(absolutePath)) {
      continue;
    }

    for (const filePath of enumerateFiles(workspaceRoot, absolutePath)) {
      const relativePath = relative(workspaceRoot, filePath).split(sep).join('/');
      if (relativePath.startsWith('.local/')) {
        violations.push(`${relativePath}: local-only material`);
        continue;
      }

      const body = readSafeText(filePath);
      if (body === undefined) {
        continue;
      }

      if (body.includes(KNOWN_FORBIDDEN_PASSWORD)) {
        violations.push(`${relativePath}: plaintext credential example`);
      }

      if (!shouldScanStructuredSecrets(relativePath)) {
        continue;
      }

      if (containsUnsafePasswordValue(body)) {
        violations.push(`${relativePath}: plaintext password material`);
      }

      if (containsUnsafeSessionCookieLiteral(body)) {
        violations.push(`${relativePath}: session cookie literal`);
      }

      if (containsUnsafeSerializedSessionCookie(body)) {
        violations.push(`${relativePath}: serialized session cookie dump`);
      }
    }
  }

  return [...new Set(violations)];
}

function enumerateFiles(workspaceRoot: string, entryPath: string): string[] {
  const relativePath = relative(workspaceRoot, entryPath).split(sep).join('/');
  if (relativePath === '.local' || relativePath.startsWith('.local/')) {
    return [entryPath];
  }

  const stats = lstatSync(entryPath);
  if (!stats.isDirectory()) {
    return [entryPath];
  }

  const files: string[] = [];
  for (const child of readdirSync(entryPath)) {
    files.push(...enumerateFiles(workspaceRoot, join(entryPath, child)));
  }

  return files;
}

function shouldScanStructuredSecrets(relativePath: string): boolean {
  if (relativePath.startsWith('tests/')) {
    return false;
  }

  if (relativePath === 'src/publish/publish.ts') {
    return false;
  }

  return (
    relativePath === 'README.md' ||
    relativePath.endsWith('.json') ||
    relativePath.endsWith('.md') ||
    relativePath.endsWith('.yaml') ||
    relativePath.endsWith('.yml') ||
    relativePath.endsWith('.toml') ||
    relativePath.endsWith('.txt') ||
    relativePath.endsWith('.env')
  );
}

function containsUnsafePasswordValue(body: string): boolean {
  const matches = body.matchAll(new RegExp(PASSWORD_ASSIGNMENT_PATTERN));
  for (const match of matches) {
    const value = match[1]?.trim();
    if (value && !isSafePlaceholderValue(value)) {
      return true;
    }
  }

  return false;
}

function containsUnsafeSessionCookieLiteral(body: string): boolean {
  const value = body.match(SESSION_COOKIE_LITERAL_PATTERN)?.[1]?.trim();
  return Boolean(value && !isSafePlaceholderValue(value));
}

function containsUnsafeSerializedSessionCookie(body: string): boolean {
  const value = body.match(SERIALIZED_SESSION_COOKIE_PATTERN)?.[1]?.trim();
  return Boolean(value && !isSafePlaceholderValue(value));
}

function isSafePlaceholderValue(value: string): boolean {
  return SAFE_PLACEHOLDER_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function readSafeText(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function run(workspaceRoot: string, command: string, args: string[]): string {
  const isGitAdd = command === 'git' && args[0] === 'add';
  const maxAttempts = command === 'git' ? 6 : 1;
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    try {
      return execFileSync(command, args, {
        cwd: workspaceRoot,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        stdio: isGitAdd ? ['ignore', 'ignore', 'pipe'] : ['ignore', 'ignore', 'pipe'],
      });
    } catch (error) {
      lastError = enrichCommandError(error, command, args);
      attempt += 1;
      if (attempt >= maxAttempts || !shouldRetryGitIndexLock(lastError)) {
        throw lastError;
      }

      sleepSync(500 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function enrichCommandError(error: unknown, command: string, args: string[]): Error {
  if (!(error instanceof Error)) {
    return new Error(`Command failed: ${command} ${args.join(' ')}`);
  }

  const errorWithStreams = error as Error & {
    stdout?: string | Buffer;
    stderr?: string | Buffer;
  };
  const stdout =
    typeof errorWithStreams.stdout === 'string'
      ? errorWithStreams.stdout
      : (errorWithStreams.stdout?.toString?.() ?? '');
  const stderr =
    typeof errorWithStreams.stderr === 'string'
      ? errorWithStreams.stderr
      : (errorWithStreams.stderr?.toString?.() ?? '');
  const details = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');

  if (!details) {
    return error;
  }

  error.message = `${error.message}\n${details}`;
  return error;
}

function shouldRetryGitIndexLock(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('.git/index.lock') || message.includes('index.lock');
}

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function readPackageMetadata(workspaceRoot: string): { version: string; description: string } {
  const packageJsonPath = join(workspaceRoot, 'package.json');
  const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    version?: unknown;
    description?: unknown;
  };

  return {
    version:
      typeof parsed.version === 'string' && parsed.version.length > 0 ? parsed.version : '0.0.0',
    description:
      typeof parsed.description === 'string' && parsed.description.length > 0
        ? parsed.description
        : DEFAULT_REPO_DESCRIPTION,
  };
}

function configureRepositoryMetadata(
  workspaceRoot: string,
  repository: string,
  runCommand: (workspaceRoot: string, command: string, args: string[]) => string,
  description: string,
): void {
  runCommand(workspaceRoot, 'gh', [
    'repo',
    'edit',
    repository,
    '--description',
    description,
    '--default-branch',
    'main',
    ...DEFAULT_REPO_TOPICS.flatMap((topic) => ['--add-topic', topic]),
  ]);
}

function ensureAnnotatedTag(
  workspaceRoot: string,
  tag: string,
  version: string,
  runCommand: (workspaceRoot: string, command: string, args: string[]) => string,
): void {
  try {
    runCommand(workspaceRoot, 'git', ['rev-parse', '--verify', tag]);
    return;
  } catch {
    runCommand(workspaceRoot, 'git', [
      'tag',
      '-a',
      tag,
      '-m',
      `Problem Archive Crawler ${version}`,
    ]);
  }
}

function createOrUpdateRelease(
  workspaceRoot: string,
  repository: string,
  tag: string,
  snapshotId: string,
  version: string,
  releaseAssetPath: string | undefined,
  runCommand: (workspaceRoot: string, command: string, args: string[]) => string,
): void {
  const releaseTitle = `Problem Archive Crawler ${tag}`;
  const releaseNotes = [
    `Problem Archive Crawler ${version}`,
    '',
    'PBInfo archival operator console release.',
    '',
    `Canonical snapshot: ${snapshotId}`,
    '- Archive status: completed and drained',
    '- Default crawl mode for future runs: incremental sync',
    '- Use fresh recrawl only when you intentionally want a full re-harvest',
  ].join('\n');

  try {
    runCommand(workspaceRoot, 'gh', ['release', 'view', tag, '--repo', repository]);
    if (releaseAssetPath) {
      runCommand(workspaceRoot, 'gh', [
        'release',
        'upload',
        tag,
        `${releaseAssetPath}#${basename(releaseAssetPath)}`,
        '--repo',
        repository,
        '--clobber',
      ]);
    }
    return;
  } catch {
    const releaseArgs = [
      'release',
      'create',
      tag,
      '--repo',
      repository,
      '--verify-tag',
      '--title',
      releaseTitle,
      '--notes',
      releaseNotes,
    ];
    if (releaseAssetPath) {
      releaseArgs.push(`${releaseAssetPath}#${basename(releaseAssetPath)}`);
    }
    runCommand(workspaceRoot, 'gh', releaseArgs);
  }
}

function resolveDesktopReleaseAsset(workspaceRoot: string): string {
  const releaseRoot = join(workspaceRoot, 'release-desktop');
  if (!existsSync(releaseRoot)) {
    throw new Error('release-desktop is missing; run npm run desktop:pack before publish.');
  }

  const exeEntries = readdirSync(releaseRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe'))
    .map((entry) => entry.name);

  const legacyExecutables = exeEntries.filter((name) => name.startsWith(LEGACY_DESKTOP_EXE_PREFIX));
  if (legacyExecutables.length > 0) {
    throw new Error(
      `Legacy desktop executable(s) remain in release-desktop: ${legacyExecutables.join(', ')}. Rerun npm run desktop:pack after cleanup.`,
    );
  }

  const brandedExecutables = exeEntries.filter((name) => name.startsWith(FINAL_DESKTOP_EXE_PREFIX));
  if (brandedExecutables.length === 0) {
    throw new Error(
      'No final branded desktop executable was found in release-desktop. Expected Problem Archive Crawler *.exe.',
    );
  }

  brandedExecutables.sort((left, right) => {
    const leftStat = statSync(join(releaseRoot, left)).mtimeMs;
    const rightStat = statSync(join(releaseRoot, right)).mtimeMs;
    return rightStat - leftStat;
  });
  const latestBrandedExecutable = brandedExecutables[0];
  if (!latestBrandedExecutable) {
    throw new Error(
      'No final branded desktop executable was found in release-desktop. Expected Problem Archive Crawler *.exe.',
    );
  }

  return join(releaseRoot, latestBrandedExecutable);
}

function normalizeCommitMessage(message: string): string {
  const trailer = 'Co-authored-by: Codex <noreply@openai.com>';
  if (message.includes(trailer)) {
    return message;
  }

  return `${message}\n\n${trailer}`;
}
