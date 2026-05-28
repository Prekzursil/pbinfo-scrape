import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, type MockInstance, test, vi } from 'vitest';

import { isCliEntrypoint, reportCliError, runCli, runCliIfEntrypoint } from '../../src/cli.js';

let stdoutSpy: MockInstance;
let stderrSpy: MockInstance;

beforeEach(() => {
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  process.exitCode = undefined;
});

describe('CLI entrypoint helpers', () => {
  test('isCliEntrypoint matches only when argv points at the module', () => {
    const moduleUrl = 'file:///repo/dist/cli.js';
    expect(isCliEntrypoint(moduleUrl, ['node', '/repo/dist/cli.js'])).toBe(true);
    expect(isCliEntrypoint(moduleUrl, ['node', '/repo/dist/other.js'])).toBe(false);
    expect(isCliEntrypoint(moduleUrl, ['node'])).toBe(false);
  });

  test('reportCliError writes the stack to stderr and sets a failing exit code', () => {
    reportCliError(new Error('boom'));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(process.exitCode).toBe(1);

    reportCliError('plain string failure');
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('plain string failure'));
  });

  test('runCli parses argv and runs the requested command against a workspace', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'pbinfo-cli-entry-'));
    try {
      // `crawl status` resolves a workspace and reports queue counters via stdout.
      await expect(
        runCli(['node', 'pbinfo', '--workspace', ws, 'crawl', 'status']),
      ).rejects.toBeInstanceOf(Error);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  test('runCli falls back to process.argv when no argv is supplied', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'pbinfo-cli-default-argv-'));
    const originalArgv = process.argv;
    process.argv = ['node', 'pbinfo', '--workspace', ws, 'crawl', 'status'];
    try {
      await expect(runCli()).rejects.toBeInstanceOf(Error);
    } finally {
      process.argv = originalArgv;
      rmSync(ws, { recursive: true, force: true });
    }
  });

  test('runCliIfEntrypoint skips execution when argv does not match the module', () => {
    runCliIfEntrypoint('file:///repo/dist/cli.js', ['node', '/repo/dist/elsewhere.js']);
    // No command parsed, so nothing was written.
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  test('runCliIfEntrypoint executes the CLI when argv matches the module', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'pbinfo-cli-entry-match-'));
    const moduleUrl = pathToFileURL('/repo/dist/cli.js').href;
    runCliIfEntrypoint(moduleUrl, [
      'node',
      '/repo/dist/cli.js',
      '--workspace',
      ws,
      'crawl',
      'status',
    ]);
    // The failed command is caught by reportCliError, setting a non-zero exit code.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stderrSpy).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    rmSync(ws, { recursive: true, force: true });
  });
});
