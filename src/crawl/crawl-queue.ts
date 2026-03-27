import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { CrawlQueueInput, CrawlQueueItem, CrawlSnapshot } from '../types/crawl.js';

interface CompletionPayload {
  contentHash?: string;
  httpStatus?: number;
}

interface FailurePayload {
  errorMessage: string;
  nextVisibleAt: string;
}

type QueueRow = {
  id: number;
  key: string;
  url: string;
  kind: string;
  status: 'pending' | 'in_progress' | 'completed';
  attempt_count: number;
  created_at: string;
  updated_at: string;
  visible_at: string | null;
  last_error: string | null;
  content_hash: string | null;
  http_status: number | null;
};

export class CrawlQueue {
  private readonly databasePath: string;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    mkdirSync(dirname(databasePath), { recursive: true });
    this.withDatabase(() => undefined);
  }

  close(): void {}

  enqueueMany(inputs: CrawlQueueInput[]): void {
    if (inputs.length === 0) {
      return;
    }

    const now = new Date().toISOString();
    this.withDatabase((database) => {
      const statement = database.prepare(`
        INSERT OR IGNORE INTO crawl_queue (
          key,
          url,
          kind,
          status,
          attempt_count,
          created_at,
          updated_at,
          visible_at,
          last_error,
          content_hash,
          http_status
        ) VALUES (
          $key,
          $url,
          $kind,
          'pending',
          0,
          $createdAt,
          $updatedAt,
          NULL,
          NULL,
          NULL,
          NULL
        )
      `);

      database.exec('BEGIN');
      try {
        for (const record of inputs) {
          statement.run({
            key: record.key,
            url: record.url,
            kind: record.kind,
            createdAt: now,
            updatedAt: now,
          });
        }
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    });
  }

  claimNext(now: Date): CrawlQueueItem | null {
    const nowIso = now.toISOString();
    return this.withDatabase((database) => {
      database.exec('BEGIN IMMEDIATE');
      try {
        const row = database
          .prepare(`
            SELECT *
            FROM crawl_queue
            WHERE status = 'pending'
              AND (visible_at IS NULL OR visible_at <= ?)
            ORDER BY
              CASE kind
                WHEN 'evaluation-detail' THEN 0
                WHEN 'official-evaluation-detail' THEN 0
                WHEN 'user-solutions' THEN 1
                WHEN 'official-source-list' THEN 1
                WHEN 'public-page' THEN 2
                WHEN 'public-asset' THEN 3
                ELSE 4
              END ASC,
              created_at ASC,
              id ASC
            LIMIT 1
          `)
          .get(nowIso) as QueueRow | undefined;

        if (!row) {
          database.exec('COMMIT');
          return null;
        }

        database
          .prepare(`
            UPDATE crawl_queue
            SET status = 'in_progress',
                attempt_count = attempt_count + 1,
                updated_at = ?,
                visible_at = NULL
            WHERE id = ?
          `)
          .run(nowIso, row.id);

        const claimed = database
          .prepare(`SELECT * FROM crawl_queue WHERE id = ?`)
          .get(row.id) as QueueRow | undefined;

        database.exec('COMMIT');
        return claimed ? this.mapRow(claimed) : null;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    });
  }

  complete(id: number, payload: CompletionPayload): void {
    this.withDatabase((database) => {
      database
        .prepare(`
          UPDATE crawl_queue
          SET status = 'completed',
              updated_at = ?,
              visible_at = NULL,
              last_error = NULL,
              content_hash = ?,
              http_status = ?
          WHERE id = ?
        `)
        .run(
          new Date().toISOString(),
          payload.contentHash ?? null,
          payload.httpStatus ?? null,
          id,
        );
    });
  }

  fail(id: number, payload: FailurePayload): void {
    this.withDatabase((database) => {
      database
        .prepare(`
          UPDATE crawl_queue
          SET status = 'pending',
              updated_at = ?,
              visible_at = ?,
              last_error = ?
          WHERE id = ?
        `)
        .run(new Date().toISOString(), payload.nextVisibleAt, payload.errorMessage, id);
    });
  }

  requeueInProgress(reason = 'requeued after interrupted crawl'): number {
    return this.withDatabase((database) => {
      const now = new Date().toISOString();
      const result = database
        .prepare(`
          UPDATE crawl_queue
          SET status = 'pending',
              updated_at = ?,
              visible_at = NULL,
              last_error = COALESCE(last_error, ?)
          WHERE status = 'in_progress'
        `)
        .run(now, reason);

      return Number(result.changes ?? 0);
    });
  }

  getSnapshot(): CrawlSnapshot {
    return this.withDatabase((database) => {
      return readSnapshotFromDatabase(database);
    });
  }

  private mapRow(row: QueueRow): CrawlQueueItem {
    return {
      id: row.id,
      key: row.key,
      url: row.url,
      kind: row.kind as CrawlQueueItem['kind'],
      status: row.status,
      attemptCount: row.attempt_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      visibleAt: row.visible_at ?? undefined,
      lastError: row.last_error ?? undefined,
      contentHash: row.content_hash ?? undefined,
      httpStatus: row.http_status ?? undefined,
    };
  }

  private withDatabase<T>(operation: (database: DatabaseSync) => T): T {
    const database = new DatabaseSync(this.databasePath);
    try {
      database.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE IF NOT EXISTS crawl_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL UNIQUE,
          url TEXT NOT NULL,
          kind TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempt_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          visible_at TEXT,
          last_error TEXT,
          content_hash TEXT,
          http_status INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_crawl_queue_claim
          ON crawl_queue(status, visible_at, created_at, id);
      `);

      return operation(database);
    } finally {
      database.close();
    }
  }
}

export function readCrawlQueueSnapshot(databasePath: string): CrawlSnapshot {
  if (!existsSync(databasePath)) {
    return {
      pending: 0,
      completed: 0,
      inProgress: 0,
      items: [],
    };
  }

  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    database.exec('PRAGMA busy_timeout = 5000;');
    return readSnapshotFromDatabase(database);
  } finally {
    database.close();
  }
}

function readSnapshotFromDatabase(database: DatabaseSync): CrawlSnapshot {
  const counts = database
    .prepare(`
      SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress
      FROM crawl_queue
    `)
    .get() as
      | {
          pending: number | null;
          completed: number | null;
          in_progress: number | null;
        }
      | undefined;

  const rows = database
    .prepare(`
      SELECT *
      FROM crawl_queue
      ORDER BY created_at ASC, id ASC
    `)
    .all() as QueueRow[];

  return {
    pending: counts?.pending ?? 0,
    completed: counts?.completed ?? 0,
    inProgress: counts?.in_progress ?? 0,
    items: rows.map(mapRow),
  };
}

function mapRow(row: QueueRow): CrawlQueueItem {
  return {
    id: row.id,
    key: row.key,
    url: row.url,
    kind: row.kind as CrawlQueueItem['kind'],
    status: row.status,
    attemptCount: row.attempt_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    visibleAt: row.visible_at ?? undefined,
    lastError: row.last_error ?? undefined,
    contentHash: row.content_hash ?? undefined,
    httpStatus: row.http_status ?? undefined,
  };
}
