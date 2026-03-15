import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  type GuiJobEvent,
  type GuiJobKind,
  type GuiJobRecord,
  guiJobEventSchema,
  guiJobKindSchema,
  guiJobRecordSchema,
} from '../shared/types.js';

interface CreateGuiJobInput {
  jobId: string;
  kind: GuiJobKind;
  profileId?: string;
  snapshotId?: string;
  detail?: Record<string, unknown>;
  now?: Date;
}

interface UpdateGuiJobInput {
  status?: GuiJobRecord['status'];
  snapshotId?: string;
  latestCounters?: GuiJobRecord['latestCounters'];
  latestEvent?: GuiJobRecord['latestEvent'];
  resumable?: boolean;
  updatedAt?: string;
  detail?: Record<string, unknown>;
}

interface TimedOptions {
  now?: Date;
}

export function createGuiJob(
  workspaceRoot: string,
  input: CreateGuiJobInput,
): GuiJobRecord {
  const resolvedWorkspace = resolve(workspaceRoot);
  const timestamp = iso(input.now);
  const record: GuiJobRecord = {
    jobId: input.jobId,
    kind: guiJobKindSchema.parse(input.kind),
    status: 'queued',
    profileId: input.profileId,
    snapshotId: input.snapshotId,
    detail: input.detail,
    logPath: getGuiJobLogPath(resolvedWorkspace, input.jobId),
    resumable: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  writeGuiJob(resolvedWorkspace, record);
  ensureFile(record.logPath, '');
  return record;
}

export function readGuiJob(
  workspaceRoot: string,
  jobId: string,
): GuiJobRecord {
  const resolvedWorkspace = resolve(workspaceRoot);
  const jobPath = getGuiJobPath(resolvedWorkspace, jobId);
  if (!existsSync(jobPath)) {
    throw new Error(`Desktop job "${jobId}" was not found.`);
  }

  return guiJobRecordSchema.parse(JSON.parse(readFileSync(jobPath, 'utf8')));
}

export function listGuiJobs(workspaceRoot: string): GuiJobRecord[] {
  const resolvedWorkspace = resolve(workspaceRoot);
  const jobsRoot = getGuiJobsRoot(resolvedWorkspace);
  if (!existsSync(jobsRoot)) {
    return [];
  }

  return readdirSync(jobsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) =>
      readGuiJob(resolvedWorkspace, entry.name.replace(/\.json$/u, '')),
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function updateGuiJob(
  workspaceRoot: string,
  jobId: string,
  patch: UpdateGuiJobInput,
): GuiJobRecord {
  const resolvedWorkspace = resolve(workspaceRoot);
  const current = readGuiJob(resolvedWorkspace, jobId);
  const next: GuiJobRecord = {
    ...current,
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.snapshotId ? { snapshotId: patch.snapshotId } : {}),
    ...(patch.latestCounters ? { latestCounters: patch.latestCounters } : {}),
    ...(patch.latestEvent ? { latestEvent: patch.latestEvent } : {}),
    ...(patch.detail ? { detail: patch.detail } : {}),
    ...(patch.resumable !== undefined ? { resumable: patch.resumable } : {}),
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  };
  writeGuiJob(resolvedWorkspace, next);
  return next;
}

export function appendGuiJobEvent(
  workspaceRoot: string,
  jobId: string,
  event: GuiJobEvent,
): GuiJobRecord {
  const resolvedWorkspace = resolve(workspaceRoot);
  const parsedEvent = guiJobEventSchema.parse(event);
  const current = readGuiJob(resolvedWorkspace, jobId);
  ensureFile(current.logPath, '');
  const nextLine = `${JSON.stringify(parsedEvent)}\n`;
  appendFileSync(current.logPath, nextLine, 'utf8');
  return updateGuiJob(resolvedWorkspace, jobId, {
    latestEvent: parsedEvent,
    latestCounters: parsedEvent.counters ?? current.latestCounters,
    updatedAt: parsedEvent.timestamp,
    detail:
      parsedEvent.detail
        ? {
            ...(current.detail ?? {}),
            ...parsedEvent.detail,
          }
        : current.detail,
  });
}

export function readGuiJobEvents(
  workspaceRoot: string,
  jobId: string,
  limit = 50,
): GuiJobEvent[] {
  const current = readGuiJob(workspaceRoot, jobId);
  if (!existsSync(current.logPath)) {
    return [];
  }

  return readFileSync(current.logPath, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-limit)
    .map((line) => guiJobEventSchema.parse(JSON.parse(line)));
}

export function recoverInterruptedGuiJobs(
  workspaceRoot: string,
  options: TimedOptions = {},
): GuiJobRecord[] {
  const resolvedWorkspace = resolve(workspaceRoot);
  return listGuiJobs(resolvedWorkspace)
    .filter((job) => job.status === 'running' && job.kind === 'crawl')
    .map((job) =>
      updateGuiJob(resolvedWorkspace, job.jobId, {
        status: 'paused',
        resumable: true,
        updatedAt: iso(options.now),
      }),
    );
}

function writeGuiJob(workspaceRoot: string, record: GuiJobRecord): void {
  const parsed = guiJobRecordSchema.parse(record);
  const jobPath = getGuiJobPath(workspaceRoot, parsed.jobId);
  mkdirSync(dirname(jobPath), { recursive: true });
  writeFileSync(jobPath, JSON.stringify(parsed, null, 2), 'utf8');
}

function getGuiJobsRoot(workspaceRoot: string): string {
  return join(workspaceRoot, '.local', 'gui', 'jobs');
}

function getGuiLogsRoot(workspaceRoot: string): string {
  return join(workspaceRoot, '.local', 'gui', 'logs');
}

function getGuiJobPath(workspaceRoot: string, jobId: string): string {
  return join(getGuiJobsRoot(workspaceRoot), `${jobId}.json`);
}

function getGuiJobLogPath(workspaceRoot: string, jobId: string): string {
  return join(getGuiLogsRoot(workspaceRoot), `${jobId}.jsonl`);
}

function ensureFile(filePath: string, contents: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  if (!existsSync(filePath)) {
    writeFileSync(filePath, contents, 'utf8');
  }
}

function iso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}
