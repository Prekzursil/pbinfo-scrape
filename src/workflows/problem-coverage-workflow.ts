import {
  buildProblemCoverageDataset,
  type ProblemCoverageWorkflowResult,
} from '../coverage/problem-coverage.js';

export { type ProblemCoverageWorkflowResult };

export async function runProblemCoverageWorkflow(
  workspaceRoot: string,
  snapshotId?: string,
): Promise<ProblemCoverageWorkflowResult> {
  return buildProblemCoverageDataset(workspaceRoot, snapshotId);
}
