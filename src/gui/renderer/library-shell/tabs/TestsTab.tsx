import type { DesktopBridge } from '../../../shared/bridge.js';
import type { ProblemDetailPayload } from '../../../main/library-detail-repository.js';

export interface TestsTabProps {
  readonly bridge: DesktopBridge;
  readonly tests: ProblemDetailPayload['tests'];
}

export function TestsTab({ bridge, tests }: TestsTabProps) {
  if (tests.cases.length === 0) {
    return (
      <section className="tests-tab">
        <p className="tests-tab__empty">
          No test cases archived for this problem.
        </p>
      </section>
    );
  }

  return (
    <section className="tests-tab">
      <div className="tests-tab__header">
        <button
          type="button"
          className="pac-btn pac-btn--secondary"
          onClick={() => void bridge.shell.openPath(tests.folderPath)}
        >
          Open folder
        </button>
        <code className="tests-tab__path" title={tests.folderPath}>
          {tests.folderPath}
        </code>
      </div>
      <ul className="tests-tab__cases">
        {tests.cases.map((tc) => (
          <li key={tc.id} className="tests-tab__case">
            <div className="tests-tab__case-header">
              <span className={`pac-chip pac-chip--${tc.kind}`}>{tc.kind}</span>
              {tc.evaluationVerdicts && (
                <span className="tests-tab__verdicts">
                  {Object.entries(tc.evaluationVerdicts).map(
                    ([lang, verdict]) => (
                      <span
                        key={lang}
                        className={`pac-chip pac-chip--verdict-${verdict}`}
                      >
                        {lang}: {verdict}
                      </span>
                    ),
                  )}
                </span>
              )}
            </div>
            <div className="tests-tab__case-body">
              <div>
                <h4>Input</h4>
                <pre>{tc.inputBody}</pre>
                <button
                  type="button"
                  className="pac-btn pac-btn--ghost"
                  onClick={() =>
                    void bridge.shell.copyToClipboard(tc.inputBody)
                  }
                  aria-label={`Copy input for case ${tc.id}`}
                >
                  Copy input
                </button>
              </div>
              <div>
                <h4>Expected</h4>
                <pre>{tc.expectedBody}</pre>
                <button
                  type="button"
                  className="pac-btn pac-btn--ghost"
                  onClick={() =>
                    void bridge.shell.copyToClipboard(tc.expectedBody)
                  }
                  aria-label={`Copy expected output for case ${tc.id}`}
                >
                  Copy expected
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
