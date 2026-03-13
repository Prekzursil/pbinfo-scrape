import type { CrawlKind } from './records.js';

export interface CrawlQueueInput {
  key: string;
  url: string;
  kind: CrawlKind;
}

export interface CrawlQueueItem extends CrawlQueueInput {
  id: number;
  status: 'pending' | 'in_progress' | 'completed';
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  visibleAt?: string;
  lastError?: string;
  contentHash?: string;
  httpStatus?: number;
}

export interface CrawlSnapshot {
  pending: number;
  completed: number;
  inProgress: number;
  items: CrawlQueueItem[];
}
