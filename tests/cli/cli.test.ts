import { describe, expect, test } from 'vitest';

import { buildCli } from '../../src/cli.js';

describe('buildCli', () => {
  test('registers the planned top-level commands', () => {
    const cli = buildCli();
    const commandNames = cli.commands.map((command) => command.name());

    expect(commandNames).toEqual([
      'auth',
      'crawl',
      'normalize',
      'snapshot',
      'rank',
      'artifacts',
      'secrets',
      'build-mirror',
      'serve',
      'resume',
      'publish',
    ]);
  });

  test('exposes auth, crawl, normalize, snapshot, and artifacts subcommands', () => {
    const cli = buildCli();
    const authCommand = cli.commands.find((command) => command.name() === 'auth');
    const crawlCommand = cli.commands.find((command) => command.name() === 'crawl');
    const normalizeCommand = cli.commands.find((command) => command.name() === 'normalize');
    const snapshotCommand = cli.commands.find((command) => command.name() === 'snapshot');
    const artifactsCommand = cli.commands.find((command) => command.name() === 'artifacts');

    expect(authCommand?.commands.map((command) => command.name())).toEqual([
      'login',
      'import-cookies',
      'import-browser',
      'bundle',
      'restore-bundle',
    ]);
    expect(crawlCommand?.commands.map((command) => command.name())).toEqual([
      'public',
      'user',
      'all',
      'status',
    ]);
    expect(normalizeCommand?.commands.map((command) => command.name())).toEqual(['snapshot']);
    expect(snapshotCommand?.commands.map((command) => command.name())).toEqual(['finalize']);
    expect(artifactsCommand?.commands.map((command) => command.name())).toEqual([
      'export-raw',
      'import-raw',
    ]);
  });

  test('supports selecting incremental or fresh crawl mode from crawl commands', () => {
    const cli = buildCli();
    const crawlCommand = cli.commands.find((command) => command.name() === 'crawl');
    const publicCommand = crawlCommand?.commands.find((command) => command.name() === 'public');
    const userCommand = crawlCommand?.commands.find((command) => command.name() === 'user');
    const allCommand = crawlCommand?.commands.find((command) => command.name() === 'all');

    for (const command of [publicCommand, userCommand, allCommand]) {
      expect(command?.options.map((option) => option.long)).toContain('--mode');
    }
  });

  test('exposes release-style publish options', () => {
    const cli = buildCli();
    const publishCommand = cli.commands.find((command) => command.name() === 'publish');

    expect(publishCommand?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining([
        '--snapshot',
        '--release',
        '--tag',
        '--upload-desktop-exe',
      ]),
    );
  });
});
