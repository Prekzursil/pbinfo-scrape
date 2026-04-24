import { randomUUID } from 'node:crypto';

export type RefreshPhase =
  | 'auth'
  | 'crawl-list'
  | 'crawl-detail'
  | 'normalize'
  | 'rank'
  | 'materialize'
  | 'mirror'
  | 'finalize';

export interface RefreshProgress {
  readonly jobId: string;
  readonly phase: RefreshPhase;
  readonly processed: number;
  readonly total?: number;
  readonly etaSeconds?: number;
  readonly lastItem?: string;
  readonly message?: string;
}

export interface ArchiveChangedEventOutgoing {
  readonly archiveRoot: string;
  readonly snapshotId?: string;
  readonly cause: 'manual-override' | 'refresh-complete' | 'snapshot-switch';
}

export interface RunPipelineInput {
  readonly jobId: string;
  readonly snapshotLabel?: string;
  readonly signal: AbortSignal;
  readonly onProgress: (event: Omit<RefreshProgress, 'jobId'>) => void;
}

export interface RunPipelineResult {
  readonly archiveRoot: string;
  readonly snapshotId: string;
}

export interface RunRefreshDeps {
  readonly runPipeline: (input: RunPipelineInput) => Promise<RunPipelineResult>;
  readonly broadcast: (event: RefreshProgress) => void;
  readonly broadcastArchiveChanged: (event: ArchiveChangedEventOutgoing) => void;
}

export interface RunRefreshCoordinator {
  readonly start: (input: { snapshotLabel?: string }) => {
    readonly jobId: string;
    readonly completion: Promise<void>;
  };
  readonly cancel: (input: { jobId: string }) => { readonly cancelled: boolean };
  readonly isActive: () => boolean;
}

const THROTTLE_MS = 250;

export function createRunRefreshCoordinator(
  deps: RunRefreshDeps,
): RunRefreshCoordinator {
  let currentJobId: string | undefined;
  let currentCompletion: Promise<void> | undefined;
  let abortController: AbortController | undefined;

  return {
    start({ snapshotLabel }) {
      if (currentJobId && currentCompletion) {
        return { jobId: currentJobId, completion: currentCompletion };
      }
      const jobId = randomUUID();
      currentJobId = jobId;
      abortController = new AbortController();

      let lastBroadcast = 0;
      const onProgress = (p: Omit<RefreshProgress, 'jobId'>): void => {
        const now = Date.now();
        // Always emit terminal finalize/phase updates; throttle mid-stream
        // progress chatter to at most 1 per THROTTLE_MS window.
        const forceEmit = p.phase === 'finalize';
        if (!forceEmit && now - lastBroadcast < THROTTLE_MS) return;
        lastBroadcast = now;
        deps.broadcast({ jobId, ...p });
      };

      currentCompletion = (async () => {
        try {
          const result = await deps.runPipeline({
            jobId,
            snapshotLabel,
            signal: abortController!.signal,
            onProgress,
          });
          deps.broadcast({
            jobId,
            phase: 'finalize',
            processed: 1,
            total: 1,
            message: 'completed',
          });
          deps.broadcastArchiveChanged({
            archiveRoot: result.archiveRoot,
            snapshotId: result.snapshotId,
            cause: 'refresh-complete',
          });
        } catch (error) {
          const message =
            error instanceof Error && error.message === 'cancelled'
              ? 'cancelled'
              : 'failed';
          deps.broadcast({
            jobId,
            phase: 'finalize',
            processed: 0,
            total: 1,
            message,
          });
        } finally {
          currentJobId = undefined;
          currentCompletion = undefined;
          abortController = undefined;
        }
      })();

      return { jobId, completion: currentCompletion };
    },
    cancel({ jobId }) {
      if (jobId !== currentJobId || !abortController) {
        return { cancelled: false };
      }
      abortController.abort();
      return { cancelled: true };
    },
    isActive() {
      return Boolean(currentJobId);
    },
  };
}
