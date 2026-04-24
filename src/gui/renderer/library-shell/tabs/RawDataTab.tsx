import type { DesktopBridge } from '../../../shared/bridge.js';
import type { ProblemDetailPayload } from '../../../main/library-detail-repository.js';

export interface RawDataTabProps {
  readonly bridge: DesktopBridge;
  readonly rawPaths: ProblemDetailPayload['rawPaths'];
}

interface RawEntry {
  readonly label: string;
  readonly path: string;
}

export function RawDataTab({ bridge, rawPaths }: RawDataTabProps) {
  const entries: RawEntry[] = [
    { label: 'Normalized problem JSON', path: rawPaths.normalized },
    { label: 'Coverage record', path: rawPaths.coverage },
    ...rawPaths.evaluations.map((path) => ({
      label: 'Evaluation',
      path,
    })),
    ...rawPaths.sources.map((path) => ({
      label: 'Source file',
      path,
    })),
    ...rawPaths.rawHtmlPages.map((path) => ({
      label: 'Raw HTML page',
      path,
    })),
  ];
  return (
    <section className="raw-data-tab">
      <table>
        <thead>
          <tr>
            <th>Kind</th>
            <th>Path</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, idx) => (
            <tr key={`${entry.path}-${idx}`}>
              <td>{entry.label}</td>
              <td>
                <code>{entry.path}</code>
              </td>
              <td>
                <button
                  type="button"
                  className="pac-btn pac-btn--ghost"
                  onClick={() => void bridge.shell.openPath(entry.path)}
                >
                  Open
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
