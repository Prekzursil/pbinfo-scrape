import { describe, expect, test } from 'vitest';

import { rowStatusFor } from '../../../../src/gui/renderer/library-shell/problem-row-status.js';

describe('rowStatusFor', () => {
  test('captured maps to ok icon with correct aria-label', () => {
    expect(rowStatusFor('editorial', 'captured')).toEqual({
      kind: 'ok',
      ariaLabel: 'Editorial: captured',
      tone: 'status-ok',
    });
  });

  test('restricted maps to locked icon', () => {
    const status = rowStatusFor('officialSource', 'restricted');
    expect(status.kind).toBe('locked');
    expect(status.ariaLabel).toBe('Official source: restricted upstream');
    expect(status.tone).toBe('status-locked');
  });

  test('missing maps to gap icon', () => {
    expect(rowStatusFor('tests', 'missing').kind).toBe('gap');
  });

  test('not-applicable maps to na icon', () => {
    expect(rowStatusFor('mySource', 'not-applicable').kind).toBe('na');
  });

  test('each pillar produces a human-readable label prefix', () => {
    expect(rowStatusFor('statement', 'captured').ariaLabel).toContain(
      'Statement',
    );
    expect(rowStatusFor('editorial', 'captured').ariaLabel).toContain(
      'Editorial',
    );
    expect(rowStatusFor('officialSource', 'captured').ariaLabel).toContain(
      'Official source',
    );
    expect(rowStatusFor('mySource', 'captured').ariaLabel).toContain('My source');
    expect(rowStatusFor('tests', 'captured').ariaLabel).toContain('Tests');
  });
});
