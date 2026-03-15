import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { Command } from 'commander';

import {
  importBrowserCookies,
  normalizeImportedCookies,
  type SupportedChromiumBrowser,
} from './auth/cookie-import.js';
import {
  createEncryptedAuthBundle,
  restoreEncryptedAuthBundle,
} from './auth/auth-bundle.js';
import { PbinfoAuthClient } from './auth/pbinfo-auth.js';
import { probePbinfoAuthStatus } from './auth/auth-status.js';
import { persistSerializedCookies } from './auth/session-store.js';
import {
  exportRawSnapshotArtifacts,
  importRawSnapshotArtifacts,
  relinkRawSnapshotArtifacts,
} from './artifacts/raw-artifacts.js';
import { loadLocalConfig } from './config/local-config.js';
import { buildMirrorArtifacts } from './mirror/build-mirror.js';
import { startMirrorServer } from './mirror/server.js';
import { publishWorkspace } from './publish/publish.js';
import {
  resumeCrawlWorkflow,
  runCrawlWorkflow,
  type CrawlMode,
} from './workflows/crawl-workflow.js';
import { runNormalizeSnapshotWorkflow } from './workflows/normalize-workflow.js';
import { runRankingWorkflow } from './workflows/rank-workflow.js';
import {
  finalizeSnapshotWorkflow,
  getCrawlStatus,
} from './workflows/snapshot-workflow.js';

export interface CliHandlers {
  authLogin: (workspaceRoot: string) => Promise<void>;
  authStatus: (workspaceRoot: string) => Promise<void>;
  authImportCookies: (workspaceRoot: string, sourcePath: string) => Promise<void>;
  authImportBrowser: (
    workspaceRoot: string,
    browser: SupportedChromiumBrowser,
    profile?: string,
    userDataDir?: string,
  ) => Promise<void>;
  authBundle: (workspaceRoot: string, recipient?: string) => Promise<void>;
  authRestoreBundle: (workspaceRoot: string, sourcePath: string, identityPath?: string) => Promise<void>;
  crawl: (
    workspaceRoot: string,
    scope: 'public' | 'user' | 'all',
    snapshot?: string,
    acceptance?: boolean,
    mode?: CrawlMode,
  ) => Promise<void>;
  crawlStatus: (workspaceRoot: string, snapshot?: string) => Promise<void>;
  normalizeSnapshot: (workspaceRoot: string, snapshot?: string) => Promise<void>;
  snapshotFinalize: (workspaceRoot: string, snapshot: string) => Promise<void>;
  rank: (workspaceRoot: string, snapshot?: string) => Promise<void>;
  artifactsExportRaw: (workspaceRoot: string, snapshot?: string, targetPath?: string) => Promise<void>;
  artifactsImportRaw: (workspaceRoot: string, snapshot?: string, sourcePath?: string) => Promise<void>;
  artifactsRelinkRaw: (workspaceRoot: string, snapshot: string, sourcePath?: string) => Promise<void>;
  buildMirror: (workspaceRoot: string, snapshot?: string) => Promise<void>;
  serve: (workspaceRoot: string, port?: number, snapshot?: string) => Promise<void>;
  resume: (workspaceRoot: string, snapshot?: string) => Promise<void>;
  publish: (
    workspaceRoot: string,
    snapshot?: string,
    release?: boolean,
    tag?: string,
    uploadDesktopExe?: boolean,
  ) => Promise<void>;
}

export function buildCli(handlers: CliHandlers = createDefaultHandlers()): Command {
  const program = new Command();

  program
    .name('pbinfo')
    .description('Hybrid PBInfo archive crawler, ranking pipeline, and localhost mirror.')
    .option('--workspace <path>', 'Workspace root override', process.cwd());

  const auth = program.command('auth').description('Manage PBInfo authentication state');
  auth
    .command('login')
    .description('Login with credentials from the local config and persist the session cookie jar')
    .action(async () => {
      await handlers.authLogin(resolveWorkspace(program));
    });
  auth
    .command('status')
    .description('Probe PBInfo auth/session state and verify the resolved handle for authenticated crawls')
    .action(async () => {
      await handlers.authStatus(resolveWorkspace(program));
    });

  auth
    .command('import-cookies')
    .description('Import cookies from a JSON export or Playwright storage-state file')
    .requiredOption('--source <path>', 'Source cookie export path')
    .action(async (options: { source: string }) => {
      await handlers.authImportCookies(resolveWorkspace(program), options.source);
    });
  auth
    .command('import-browser')
    .description('Import pbinfo.ro cookies directly from a local Edge or Chrome browser profile')
    .requiredOption('--browser <browser>', 'Browser name: edge or chrome')
    .option('--profile <profile>', 'Chromium profile name, defaults to Default')
    .option('--user-data-dir <path>', 'Override the Chromium user data directory')
    .action(async (options: {
      browser: SupportedChromiumBrowser;
      profile?: string;
      userDataDir?: string;
    }) => {
      await handlers.authImportBrowser(
        resolveWorkspace(program),
        options.browser,
        options.profile,
        options.userDataDir,
      );
    });
  auth
    .command('bundle')
    .description('Encrypt and persist the current auth/session state for repo-safe storage')
    .option('--recipient <ageRecipient>', 'Override the configured age recipient')
    .action(async (options: { recipient?: string }) => {
      await handlers.authBundle(resolveWorkspace(program), options.recipient);
    });
  auth
    .command('restore-bundle')
    .description('Restore auth/session state from an encrypted repo-stored bundle')
    .requiredOption('--source <path>', 'Encrypted bundle path')
    .option('--identity <path>', 'Override the configured age identity path')
    .action(async (options: { source: string; identity?: string }) => {
      await handlers.authRestoreBundle(resolveWorkspace(program), options.source, options.identity);
    });

  const crawl = program.command('crawl').description('Queue and process crawl work');
  crawl
    .command('public')
    .description('Crawl the public PBInfo surface')
    .option('--snapshot <snapshot>', 'Snapshot id override')
    .option('--acceptance', 'Mark this crawl as an acceptance-oriented run')
    .option('--mode <mode>', 'Crawl mode: incremental or fresh', 'incremental')
    .action(async (options: { snapshot?: string; acceptance?: boolean; mode?: CrawlMode }) => {
      await handlers.crawl(
        resolveWorkspace(program),
        'public',
        options.snapshot,
        options.acceptance,
        options.mode,
      );
    });
  crawl
    .command('user')
    .description('Crawl authenticated user/account pages')
    .option('--snapshot <snapshot>', 'Snapshot id override')
    .option('--acceptance', 'Mark this crawl as an acceptance-oriented run')
    .option('--mode <mode>', 'Crawl mode: incremental or fresh', 'incremental')
    .action(async (options: { snapshot?: string; acceptance?: boolean; mode?: CrawlMode }) => {
      await handlers.crawl(
        resolveWorkspace(program),
        'user',
        options.snapshot,
        options.acceptance,
        options.mode,
      );
    });
  crawl
    .command('all')
    .description('Crawl both public and authenticated PBInfo surfaces')
    .option('--snapshot <snapshot>', 'Snapshot id override')
    .option('--acceptance', 'Mark this crawl as an acceptance-oriented run')
    .option('--mode <mode>', 'Crawl mode: incremental or fresh', 'incremental')
    .action(async (options: { snapshot?: string; acceptance?: boolean; mode?: CrawlMode }) => {
      await handlers.crawl(
        resolveWorkspace(program),
        'all',
        options.snapshot,
        options.acceptance,
        options.mode,
      );
    });
  crawl
    .command('status')
    .description('Report queue counts, recent failures, and publish eligibility for a snapshot')
    .option('--snapshot <snapshot>', 'Snapshot id override')
    .action(async (options: { snapshot?: string }) => {
      await handlers.crawlStatus(resolveWorkspace(program), options.snapshot);
    });

  const normalize = program.command('normalize').description('Rebuild normalized records from archived raw pages');
  normalize
    .command('snapshot')
    .description('Rebuild normalized records for a snapshot without network access')
    .option('--snapshot <snapshot>', 'Snapshot id override')
    .action(async (options: { snapshot?: string }) => {
      await handlers.normalizeSnapshot(resolveWorkspace(program), options.snapshot);
    });

  const snapshot = program.command('snapshot').description('Manage snapshot lifecycle and retention');
  snapshot
    .command('finalize')
    .description('Finalize a drained snapshot, export artifacts, and prune noncanonical snapshots')
    .requiredOption('--snapshot <snapshot>', 'Snapshot id to finalize')
    .action(async (options: { snapshot: string }) => {
      await handlers.snapshotFinalize(resolveWorkspace(program), options.snapshot);
    });

  program
    .command('rank')
    .description('Compute canonical best submissions from archived evaluations')
    .option('--snapshot <snapshot>', 'Snapshot id override')
    .action(async (options: { snapshot?: string }) => {
      await handlers.rank(resolveWorkspace(program), options.snapshot);
    });

  const artifacts = program.command('artifacts').description('Manage raw artifact snapshots');
  artifacts
    .command('export-raw')
    .description('Export the current or selected raw snapshot into an external artifact directory')
    .option('--snapshot <snapshot>', 'Snapshot id to export')
    .option('--target <path>', 'Target directory override')
    .action(async (options: { snapshot?: string; target?: string }) => {
      await handlers.artifactsExportRaw(resolveWorkspace(program), options.snapshot, options.target);
    });
  artifacts
    .command('import-raw')
    .description('Import a raw snapshot from an external artifact directory')
    .option('--snapshot <snapshot>', 'Snapshot id to import into')
    .requiredOption('--source <path>', 'Artifact manifest path')
    .action(async (options: { snapshot?: string; source?: string }) => {
      await handlers.artifactsImportRaw(resolveWorkspace(program), options.snapshot, options.source);
    });
  artifacts
    .command('relink-raw')
    .description('Relink a snapshot to externally stored raw artifacts without copying files')
    .requiredOption('--snapshot <snapshot>', 'Snapshot id to relink')
    .requiredOption('--source <path>', 'Artifact manifest path')
    .action(async (options: { snapshot: string; source: string }) => {
      await handlers.artifactsRelinkRaw(resolveWorkspace(program), options.snapshot, options.source);
    });

  const secrets = program.command('secrets').description('Manage encrypted repo-safe secret bundles');
  secrets
    .command('bootstrap')
    .description('Generate or reuse age identity material and encrypt the local auth bundle')
    .option('--recipient <ageRecipient>', 'Override the configured age recipient')
    .action(async (options: { recipient?: string }) => {
      await handlers.authBundle(resolveWorkspace(program), options.recipient);
    });
  secrets
    .command('restore')
    .description('Restore local auth/session files from the encrypted bundle')
    .requiredOption('--source <path>', 'Encrypted bundle path')
    .option('--identity <path>', 'Override the configured age identity path')
    .action(async (options: { source: string; identity?: string }) => {
      await handlers.authRestoreBundle(resolveWorkspace(program), options.source, options.identity);
    });

  program
    .command('build-mirror')
    .description('Build or refresh the localhost mirror artifacts')
    .option('--snapshot <snapshot>', 'Snapshot id override')
    .action(async (options: { snapshot?: string }) => {
      await handlers.buildMirror(resolveWorkspace(program), options.snapshot);
    });

  program
    .command('serve')
    .description('Serve the archive via a local web server')
    .option('--port <port>', 'Port to bind to', (value) => Number(value))
    .option('--snapshot <snapshot>', 'Snapshot id override')
    .action(async (options: { port?: number; snapshot?: string }) => {
      await handlers.serve(resolveWorkspace(program), options.port, options.snapshot);
    });

  program
    .command('resume')
    .description('Resume queued crawl work from the durable queue')
    .option('--snapshot <snapshot>', 'Resume a specific snapshot instead of the latest unfinished one')
    .action(async (options: { snapshot?: string }) => {
      await handlers.resume(resolveWorkspace(program), options.snapshot);
    });

  program
    .command('publish')
    .description('Prepare the local repo and publish it to the configured private GitHub repository')
    .option('--snapshot <snapshot>', 'Snapshot id override')
    .option('--release', 'Create or update a tagged GitHub release after pushing main')
    .option('--tag <tag>', 'Release tag override, defaults to v${package.version}')
    .option('--upload-desktop-exe', 'Upload the final Problem Archive Crawler portable executable to the GitHub release')
    .action(async (options: {
      snapshot?: string;
      release?: boolean;
      tag?: string;
      uploadDesktopExe?: boolean;
    }) => {
      await handlers.publish(
        resolveWorkspace(program),
        options.snapshot,
        options.release,
        options.tag,
        options.uploadDesktopExe,
      );
    });

  return program;
}

export async function runCli(argv = process.argv): Promise<void> {
  await buildCli().parseAsync(argv);
}

function resolveWorkspace(program: Command): string {
  const options = program.opts<{ workspace: string }>();
  return options.workspace;
}

function createDefaultHandlers(): CliHandlers {
  return {
    authLogin: async (workspaceRoot) => {
      const config = loadLocalConfig(workspaceRoot);
      if (config.auth.strategy !== 'credentials' || !config.auth.username || !config.auth.password) {
        throw new Error(
          'Credential login requires auth.strategy="credentials" plus username and password in .local/pbinfo.local.json',
        );
      }

      const client = new PbinfoAuthClient({
        baseUrl: 'https://www.pbinfo.ro/',
        sessionCookiesPath: config.auth.sessionCookiesPath,
      });

      const result = await client.loginWithCredentials({
        username: config.auth.username,
        password: config.auth.password,
      });
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    },
    authStatus: async (workspaceRoot) => {
      const config = loadLocalConfig(workspaceRoot);
      const result = await probePbinfoAuthStatus(config);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    },
    authImportCookies: async (workspaceRoot, sourcePath) => {
      const config = loadLocalConfig(workspaceRoot);
      const rawPayload = JSON.parse(readFileSync(sourcePath, 'utf8'));
      const normalized = normalizeImportedCookies(rawPayload);
      persistImportedCookies(config.auth.sessionCookiesPath, normalized);
      process.stdout.write(
        JSON.stringify(
          {
            imported: normalized.length,
            sessionCookiesPath: config.auth.sessionCookiesPath,
          },
          null,
          2,
        ) + '\n',
      );
    },
    authImportBrowser: async (workspaceRoot, browser, profile, userDataDir) => {
      const config = loadLocalConfig(workspaceRoot);
      const normalized = await importBrowserCookies({
        browser,
        profile,
        userDataDir,
      });
      persistImportedCookies(config.auth.sessionCookiesPath, normalized);
      process.stdout.write(
        JSON.stringify(
          {
            imported: normalized.length,
            browser,
            profile: profile ?? 'Default',
            sessionCookiesPath: config.auth.sessionCookiesPath,
          },
          null,
          2,
        ) + '\n',
      );
    },
    authBundle: async (workspaceRoot, recipient) => {
      const result = await createEncryptedAuthBundle({
        workspaceRoot,
        recipient,
      });
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    },
    authRestoreBundle: async (workspaceRoot, sourcePath, identityPath) => {
      const result = await restoreEncryptedAuthBundle({
        workspaceRoot,
        sourcePath,
        identityPath,
      });
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    },
    crawl: async (workspaceRoot, scope, snapshot, acceptance, mode = 'incremental') => {
      const result = await runCrawlWorkflow(workspaceRoot, scope, {
        snapshotId: snapshot,
        checkpoint: acceptance ? 'checkpoint' : 'canonical',
        mode,
      });
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    },
    crawlStatus: async (workspaceRoot, snapshot) => {
      const result = getCrawlStatus(workspaceRoot, snapshot);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    },
    normalizeSnapshot: async (workspaceRoot, snapshot) => {
      const result = await runNormalizeSnapshotWorkflow(workspaceRoot, snapshot);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    },
    snapshotFinalize: async (workspaceRoot, snapshot) => {
      const result = await finalizeSnapshotWorkflow(workspaceRoot, snapshot);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    },
    rank: async (workspaceRoot, snapshot) => {
      const result = await runRankingWorkflow(workspaceRoot, snapshot);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    },
    artifactsExportRaw: async (workspaceRoot, snapshot, targetPath) => {
      const result = await exportRawSnapshotArtifacts({
        workspaceRoot,
        snapshotId: snapshot ?? 'latest',
        targetPath,
      });
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    },
    artifactsImportRaw: async (workspaceRoot, snapshot, sourcePath) => {
      const result = await importRawSnapshotArtifacts({
        workspaceRoot,
        snapshotId: snapshot ?? 'latest',
        sourcePath,
      });
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    },
    artifactsRelinkRaw: async (workspaceRoot, snapshot, sourcePath) => {
      const result = await relinkRawSnapshotArtifacts({
        workspaceRoot,
        snapshotId: snapshot,
        sourcePath,
      });
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    },
    buildMirror: async (workspaceRoot, snapshot) => {
      const result = await buildMirrorArtifacts(workspaceRoot, snapshot);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    },
    serve: async (workspaceRoot, port, snapshot) => {
      const result = await startMirrorServer({
        workspaceRoot,
        port: port ?? 4173,
        snapshotId: snapshot,
      });
      process.stdout.write(`${result.baseUrl}\n`);
    },
    resume: async (workspaceRoot, snapshot) => {
      const result = await resumeCrawlWorkflow(workspaceRoot, {
        snapshotId: snapshot,
      });
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    },
    publish: async (workspaceRoot, snapshot, release, tag, uploadDesktopExe) => {
      const result = publishWorkspace({
        workspaceRoot,
        config: loadLocalConfig(workspaceRoot),
        snapshotId: snapshot,
        release,
        tag,
        uploadDesktopExe,
      });
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    },
  };
}

function persistImportedCookies(
  sessionCookiesPath: string,
  normalized: ReturnType<typeof normalizeImportedCookies>,
): void {
  persistSerializedCookies(
    sessionCookiesPath,
    normalized.map((cookie) => ({
      key: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires ?? 'Infinity',
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
    })),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
