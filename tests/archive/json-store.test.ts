import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { mergeJsonRecord, readJsonRecord, writeJsonRecord } from '../../src/archive/json-store.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('json-store', () => {
  test('mergeJsonRecord recovers from malformed JSON and rewrites a valid record', () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-json-store-'));
    tempDirs.push(root);
    const filePath = join(root, 'record.json');
    writeFileSync(filePath, '{', 'utf8');

    const merged = mergeJsonRecord<{ count: number }>(root, 'record.json', (current) => ({
      count: (current?.count ?? 0) + 1,
    }));

    expect(merged).toEqual({ count: 1 });
    expect(readJsonRecord<{ count: number }>(filePath)).toEqual({ count: 1 });
  });

  test('writeJsonRecord writes an atomic JSON payload that can be read back', () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-json-store-'));
    tempDirs.push(root);

    const path = writeJsonRecord(root, 'record.json', { ready: true });

    expect(path).toBe(join(root, 'record.json'));
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ ready: true });
  });
});
