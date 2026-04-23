import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

export const archiveStoreSchema = z
  .object({
    manualArchiveOverride: z.string().min(1).max(4096).optional(),
  })
  .strict();

export type ArchiveStore = z.infer<typeof archiveStoreSchema>;

const legacyTolerantSchema = z
  .object({
    manualArchiveOverride: z.string().min(1).max(4096).optional(),
  })
  .passthrough()
  .transform(({ manualArchiveOverride }) => ({
    ...(manualArchiveOverride ? { manualArchiveOverride } : {}),
  }));

export function getArchiveStorePath(userDataRoot: string): string {
  return join(userDataRoot, 'pbinfo-crawler-config.json');
}

export function readArchiveStore(userDataRoot: string): ArchiveStore {
  const path = getArchiveStorePath(userDataRoot);
  if (!existsSync(path)) {
    return {};
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return legacyTolerantSchema.parse(raw);
  } catch {
    return {};
  }
}

export function writeArchiveStore(
  userDataRoot: string,
  store: ArchiveStore,
): ArchiveStore {
  const parsed = archiveStoreSchema.parse(store);
  const path = getArchiveStorePath(userDataRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(parsed, null, 2), 'utf8');
  return parsed;
}
