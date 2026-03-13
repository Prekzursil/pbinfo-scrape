import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function writeJsonRecord<T>(
  root: string,
  fileName: string,
  payload: T,
): string {
  mkdirSync(root, { recursive: true });
  const path = join(root, fileName);
  writeJsonAtomic(path, payload);
  return path;
}

export function mergeJsonRecord<T>(
  root: string,
  fileName: string,
  merge: (current: T | undefined) => T,
): T {
  mkdirSync(root, { recursive: true });
  const path = join(root, fileName);
  const current = readJsonRecord<T>(path);
  const next = merge(current);
  writeJsonAtomic(path, next);
  return next;
}

export function readJsonRecord<T>(path: string): T | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function writeJsonAtomic(path: string, payload: unknown): void {
  writeFileSync(path, JSON.stringify(payload, null, 2), 'utf8');
}
