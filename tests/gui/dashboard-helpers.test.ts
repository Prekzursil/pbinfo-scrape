import { describe, expect, test } from 'vitest';

import {
  areCoverageFiltersEqual,
  buildLogEntries,
  capitalize,
  createCoverageFiltersForPreset,
  deriveCrawlTelemetry,
  describeView,
  detectOverviewPreset,
  filterLogEntries,
  formatArchiveCompletenessStatus,
  formatCounters,
  formatEta,
  formatJobMeta,
  formatJobSummary,
  formatOfficialSourceStatus,
  formatOverviewPreset,
  formatOverviewProblemSummary,
  formatProfileProvenance,
  formatRate,
  formatTestsCoverageStatus,
  formatTimestamp,
  getActiveProfile,
  toneForArchiveState,
  toneForOfficialStatus,
  toneForTestsStatus,
} from '../../src/gui/renderer/dashboard.js';
import type { CoverageExplorerFilters } from '../../src/gui/renderer/coverage-explorer.js';
import type {
  GuiCoverageRecord,
  GuiJobEvent,
  GuiJobRecord,
  GuiProfileRecord,
  GuiWorkspaceState,
} from '../../src/gui/shared/types.js';

function event(timestamp: string, completed: number, stage = 'crawl'): GuiJobEvent {
  return {
    timestamp,
    level: 'info',
    stage,
    message: 'm',
    counters: { pending: 100, completed, inProgress: 0 },
  } as GuiJobEvent;
}

const baseFilters: CoverageExplorerFilters = {
  query: '',
  solved: 'all',
  testsFragmentArchived: 'all',
  visibleTestsCaptured: 'all',
  testsCoverageStatus: 'all',
  officialSourceArchived: 'all',
  userSourceArchived: 'all',
  editorialAvailability: 'all',
  archiveCompletenessStatus: 'all',
};

describe('dashboard helpers', () => {
  test('capitalize and describeView', () => {
    expect(capitalize('raw')).toBe('Raw');
    for (const view of ['overview', 'coverage', 'data', 'setup'] as const) {
      expect(describeView(view)).toMatch(/\w/);
    }
  });

  test('overview preset and status formatters cover every case', () => {
    for (const preset of [
      'all', 'solved', 'unsolved', 'complete',
      'missing-official-source', 'missing-user-source', 'missing-tests',
    ] as const) {
      expect(formatOverviewPreset(preset)).toMatch(/\w/);
      expect(createCoverageFiltersForPreset(preset)).toBeTruthy();
    }
    for (const status of [
      'complete', 'unsolved', 'not-archived-yet',
      'missing-official-source', 'missing-user-source', 'incomplete',
    ] as const) {
      expect(formatArchiveCompletenessStatus(status)).toMatch(/\w/);
      expect(toneForArchiveState(status)).toMatch(/success|warning|neutral/);
    }
    for (const status of [
      'archived', 'restricted-upstream', 'not-available-upstream', 'not-captured-yet',
    ] as const) {
      expect(formatOfficialSourceStatus(status)).toMatch(/\w/);
      expect(toneForOfficialStatus(status)).toMatch(/success|warning|neutral/);
    }
    for (const status of ['captured', 'not-available-upstream', 'not-captured-yet'] as const) {
      expect(formatTestsCoverageStatus(status)).toMatch(/\w/);
      expect(toneForTestsStatus(status)).toMatch(/success|warning|neutral/);
    }
  });

  test('profile provenance, job meta, and counters', () => {
    const login = { provenance: { type: 'login' } } as GuiProfileRecord;
    const browser = { provenance: { type: 'browser-import', browser: 'edge' } } as GuiProfileRecord;
    const cookie = { provenance: { type: 'cookie-import' } } as GuiProfileRecord;
    expect(formatProfileProvenance(login)).toBe('Credential login');
    expect(formatProfileProvenance(browser)).toContain('Browser import');
    expect(formatProfileProvenance(cookie)).toBe('Cookie import');

    expect(formatJobMeta({ kind: 'crawl', profileId: 'p1' } as GuiJobRecord)).toContain('p1');
    expect(formatJobMeta({ kind: 'crawl' } as GuiJobRecord)).toBe('crawl');
    expect(formatJobSummary({ kind: 'rank' } as GuiJobRecord)).toMatch(/No queue counters/);
    expect(formatJobSummary({ kind: 'crawl', latestCounters: { pending: 1, completed: 2, inProgress: 0 } } as GuiJobRecord)).toContain('pending');
    expect(formatCounters(undefined)).toMatch(/No queue counters/);
    expect(formatCounters({ pending: 1, completed: 2, inProgress: 3 })).toContain('completed');
  });

  test('log entry helpers across verbosity modes', () => {
    const jobs = [
      { kind: 'crawl', latestEvent: event('2026-03-10T00:00:00.000Z', 1) } as GuiJobRecord,
      { kind: 'rank' } as GuiJobRecord,
    ];
    expect(buildLogEntries(jobs)).toHaveLength(1);
    const entries: GuiJobEvent[] = [
      event('2026-03-10T00:00:02.000Z', 3),
      { ...event('2026-03-10T00:00:01.000Z', 2), level: 'debug' } as GuiJobEvent,
    ];
    expect(filterLogEntries(entries, 'raw')).toHaveLength(2);
    expect(filterLogEntries(entries, 'verbose')).toHaveLength(1);
    expect(filterLogEntries(entries, 'normal')).toHaveLength(1);
  });

  test('getActiveProfile resolves the active profile or undefined', () => {
    const state = {
      activeProfileId: 'a',
      profiles: [{ profileId: 'a' } as GuiProfileRecord],
    } as GuiWorkspaceState;
    expect(getActiveProfile(state)?.profileId).toBe('a');
    expect(getActiveProfile(undefined)).toBeUndefined();
  });

  test('deriveCrawlTelemetry handles success and every null path', () => {
    const counters = { pending: 100, completed: 0, inProgress: 0 };
    const ok = deriveCrawlTelemetry(counters, [
      event('2026-03-10T00:00:00.000Z', 10),
      event('2026-03-10T00:01:00.000Z', 30),
    ]);
    expect(ok?.completedPerMinute).toBeCloseTo(20);
    expect(deriveCrawlTelemetry(null, [])).toBeNull();
    expect(deriveCrawlTelemetry({ pending: 0, completed: 0, inProgress: 0 }, [])).toBeNull();
    expect(deriveCrawlTelemetry(counters, [event('2026-03-10T00:00:00.000Z', 10)])).toBeNull();
    expect(
      deriveCrawlTelemetry(counters, [
        event('2026-03-10T00:00:00.000Z', 30),
        event('2026-03-10T00:01:00.000Z', 30),
      ]),
    ).toBeNull();
    expect(
      deriveCrawlTelemetry(counters, [
        event('2026-03-10T00:00:00.000Z', 10),
        event('2026-03-10T00:00:00.000Z', 30),
      ]),
    ).toBeNull();
  });

  test('formatRate, formatEta, and formatTimestamp', () => {
    expect(formatRate(6)).toBe('6.0');
    expect(formatEta(0)).toMatch(/<1m/);
    expect(formatEta(120)).toMatch(/2m remaining/);
    expect(formatEta(3 * 3600)).toMatch(/3h remaining/);
    expect(formatEta(3 * 3600 + 600)).toMatch(/3h 10m remaining/);
    expect(formatTimestamp('2026-03-10T12:34:00.000Z')).toMatch(/\w/);
  });

  test('coverage filter preset detection and equality', () => {
    for (const preset of ['all', 'solved', 'complete', 'missing-tests'] as const) {
      expect(detectOverviewPreset(createCoverageFiltersForPreset(preset))).toBe(preset);
    }
    expect(detectOverviewPreset({ ...baseFilters, query: 'x', grade: 9 })).toBeNull();
    expect(areCoverageFiltersEqual(baseFilters, baseFilters)).toBe(true);
    const fields: Array<Partial<CoverageExplorerFilters>> = [
      { query: 'z' },
      { solved: 'solved' },
      { testsFragmentArchived: 'yes' },
      { visibleTestsCaptured: 'yes' },
      { testsCoverageStatus: 'captured' },
      { officialSourceArchived: 'yes' },
      { userSourceArchived: 'yes' },
      { editorialAvailability: 'visible' },
      { archiveCompletenessStatus: 'complete' },
      { grade: 11 },
    ];
    for (const override of fields) {
      expect(areCoverageFiltersEqual(baseFilters, { ...baseFilters, ...override })).toBe(false);
    }
  });

  test('formatOverviewProblemSummary includes optional segments only when present', () => {
    const minimal = {
      solvedEvaluationCount: 1,
      evaluationCount: 2,
      requiredTrustworthyUserSourceLanguages: [],
      officialSourceLanguages: [],
      userSourceLanguages: [],
      missingTrustworthyUserSourceLanguages: [],
    } as unknown as GuiCoverageRecord;
    expect(formatOverviewProblemSummary(minimal)).toContain('1/2 solved evaluations');
    const full = {
      ...minimal,
      requiredTrustworthyUserSourceLanguages: ['cpp'],
      officialSourceLanguages: ['cpp'],
      userSourceLanguages: ['py'],
      missingTrustworthyUserSourceLanguages: ['c'],
    } as unknown as GuiCoverageRecord;
    const summary = formatOverviewProblemSummary(full);
    expect(summary).toContain('required languages');
    expect(summary).toContain('missing trustworthy');
  });
});
