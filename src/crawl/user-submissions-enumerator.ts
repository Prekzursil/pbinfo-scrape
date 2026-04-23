import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  parseUserSolutionsListPage,
  type UserSolutionListEntry,
} from '../pbinfo/parsers/user-solutions.js';
import type { CrawlQueueInput } from '../types/crawl.js';

export interface UserSubmissionsEnumeratorCursor {
  userHandle: string;
  baseUrl: string;
  nextUrl: string | null;
  lastOffset: number;
  evaluationIdsSeen: number[];
  totalMatches?: number;
  pagesVisited: number;
  updatedAt: string;
}

export interface UserSubmissionsEnumeratorOptions {
  userHandle: string;
  fetchImpl: typeof fetch;
  baseUrl?: string;
  cursorPath?: string;
  maxPages?: number;
  pageSleepMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface UserSubmissionsEnumerationResult {
  entries: UserSolutionListEntry[];
  totalMatches?: number;
  pagesVisited: number;
  throttled: boolean;
  cursor: UserSubmissionsEnumeratorCursor;
}

const DEFAULT_BASE_URL = 'https://www.pbinfo.ro/';
const DEFAULT_MAX_PAGES = 10_000;

export function buildUserSolutionsUrl(options: {
  userHandle: string;
  baseUrl?: string;
  start?: number;
}): string {
  const base = new URL(options.baseUrl ?? DEFAULT_BASE_URL);
  const url = new URL(`/solutii/user/${encodeURIComponent(options.userHandle)}`, base);
  if (typeof options.start === 'number' && options.start > 0) {
    url.searchParams.set('start', String(options.start));
  }
  return url.toString();
}

export function buildEvaluationDetailQueueEntries(
  entries: ReadonlyArray<UserSolutionListEntry>,
  baseUrl: string = DEFAULT_BASE_URL,
): CrawlQueueInput[] {
  const base = new URL(baseUrl);
  const deduped = new Map<number, UserSolutionListEntry>();
  for (const entry of entries) {
    if (!deduped.has(entry.evaluationId)) {
      deduped.set(entry.evaluationId, entry);
    }
  }

  return [...deduped.values()].map((entry) => ({
    key: `evaluation-detail:${entry.evaluationId}`,
    url: new URL(`/detalii-evaluare/${entry.evaluationId}`, base).toString(),
    kind: 'evaluation-detail' as const,
  }));
}

export async function enumerateUserSubmissions(
  options: UserSubmissionsEnumeratorOptions,
): Promise<UserSubmissionsEnumerationResult> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const now = options.now ?? (() => new Date());
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const sleep = options.sleep ?? defaultSleep;

  const existingCursor = loadCursor(options.cursorPath);
  const startingUrl =
    existingCursor?.nextUrl
    ?? buildUserSolutionsUrl({ userHandle: options.userHandle, baseUrl });

  const collectedEntries: UserSolutionListEntry[] = [];
  const seenEvaluationIds = new Set<number>(existingCursor?.evaluationIdsSeen ?? []);
  let pagesVisited = existingCursor?.pagesVisited ?? 0;
  let totalMatches = existingCursor?.totalMatches;
  let throttled = false;
  let nextUrl: string | null = startingUrl;
  let lastOffset = existingCursor?.lastOffset ?? 0;

  while (nextUrl && pagesVisited < maxPages) {
    const currentUrl: string = nextUrl;
    const response = await options.fetchImpl(currentUrl, { redirect: 'follow' });
    const html = await response.text();
    const parsed = parseUserSolutionsListPage(html, currentUrl);

    pagesVisited += 1;
    if (parsed.totalMatches !== undefined) {
      totalMatches = parsed.totalMatches;
    }
    if (parsed.currentOffset !== undefined) {
      lastOffset = parsed.currentOffset;
    }

    if (parsed.throttled) {
      throttled = true;
      break;
    }

    for (const entry of parsed.entries) {
      if (seenEvaluationIds.has(entry.evaluationId)) {
        continue;
      }
      seenEvaluationIds.add(entry.evaluationId);
      collectedEntries.push(entry);
    }

    nextUrl = parsed.nextPageUrls[0] ?? null;

    const cursor: UserSubmissionsEnumeratorCursor = {
      userHandle: options.userHandle,
      baseUrl,
      nextUrl,
      lastOffset,
      evaluationIdsSeen: [...seenEvaluationIds],
      totalMatches,
      pagesVisited,
      updatedAt: now().toISOString(),
    };
    persistCursor(options.cursorPath, cursor);

    if (options.pageSleepMs && options.pageSleepMs > 0 && nextUrl) {
      await sleep(options.pageSleepMs);
    }
  }

  const finalCursor: UserSubmissionsEnumeratorCursor = {
    userHandle: options.userHandle,
    baseUrl,
    nextUrl,
    lastOffset,
    evaluationIdsSeen: [...seenEvaluationIds],
    totalMatches,
    pagesVisited,
    updatedAt: now().toISOString(),
  };

  return {
    entries: collectedEntries,
    totalMatches,
    pagesVisited,
    throttled,
    cursor: finalCursor,
  };
}

function loadCursor(cursorPath: string | undefined): UserSubmissionsEnumeratorCursor | undefined {
  if (!cursorPath || !existsSync(cursorPath)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(cursorPath, 'utf8')) as UserSubmissionsEnumeratorCursor;
  } catch {
    return undefined;
  }
}

function persistCursor(
  cursorPath: string | undefined,
  cursor: UserSubmissionsEnumeratorCursor,
): void {
  if (!cursorPath) {
    return;
  }
  mkdirSync(dirname(cursorPath), { recursive: true });
  writeFileSync(cursorPath, JSON.stringify(cursor, null, 2), 'utf8');
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
