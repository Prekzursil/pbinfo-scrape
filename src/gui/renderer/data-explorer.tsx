import type {
  GuiArchiveDataset,
  GuiArchiveDatasetSummary,
  GuiArchiveListing,
  GuiArchiveRecordDetail,
} from '../shared/types.js';

export interface DataExplorerPanelProps {
  snapshotId: string;
  normalizedRoot?: string;
  mirrorRoot?: string;
  mirrorServeCommand?: string;
  mirrorUrl?: string;
  datasetSummaries: GuiArchiveDatasetSummary[];
  selectedDataset: GuiArchiveDataset;
  selectedRecordId: string | null;
  archiveQuery: string;
  listing: GuiArchiveListing | null;
  detail: GuiArchiveRecordDetail | null;
  previewUrl?: string;
  onDatasetChange: (dataset: GuiArchiveDataset) => void;
  onArchiveQueryChange: (query: string) => void;
  onSelectRecord: (recordId: string) => void;
  onOpenPath: (path: string) => Promise<unknown>;
  onOpenExternal: (url: string) => Promise<unknown>;
}

export function DataExplorerPanel(props: DataExplorerPanelProps) {
  const {
    snapshotId,
    normalizedRoot,
    mirrorRoot,
    mirrorServeCommand,
    mirrorUrl,
    datasetSummaries,
    selectedDataset,
    selectedRecordId,
    archiveQuery,
    listing,
    detail,
    previewUrl,
    onDatasetChange,
    onArchiveQueryChange,
    onSelectRecord,
    onOpenPath,
    onOpenExternal,
  } = props;

  const liveMirrorRecordUrl =
    previewUrl && detail?.mirrorRoute
      ? new URL(detail.mirrorRoute, previewUrl).toString()
      : undefined;

  return (
    <section className="panel data-panel panel-workspace">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Structured archive</p>
          <h2>Data Explorer</h2>
        </div>
        <span className="panel-chip">{snapshotId}</span>
      </div>

      <div className="data-workspace-top">
        <div className="archive-location-grid">
          <article className="summary-card">
            <span className="metric-label">Normalized archive</span>
            <p className="mono archive-path">{normalizedRoot ?? 'Not available'}</p>
            <div className="button-row">
              <button
                className="ghost-button"
                type="button"
                disabled={!normalizedRoot}
                onClick={() => {
                  if (normalizedRoot) {
                    void onOpenPath(normalizedRoot);
                  }
                }}
              >
                Open normalized archive folder
              </button>
            </div>
          </article>
          <article className="summary-card">
            <span className="metric-label">Mirror output</span>
            <p className="mono archive-path">{mirrorRoot ?? 'Not available'}</p>
            <div className="button-row">
              <button
                className="ghost-button"
                type="button"
                disabled={!mirrorRoot}
                onClick={() => {
                  if (mirrorRoot) {
                    void onOpenPath(mirrorRoot);
                  }
                }}
              >
                Open mirror output folder
              </button>
              <button
                className="ghost-button"
                type="button"
                disabled={!mirrorUrl}
                onClick={() => {
                  if (mirrorUrl) {
                    void onOpenExternal(mirrorUrl);
                  }
                }}
              >
                Open mirror in browser
              </button>
            </div>
            <p className="summary-copy">
              {mirrorServeCommand
                ? `Serve locally with: ${mirrorServeCommand}`
                : 'Serve the selected snapshot locally to browse it like a website.'}
            </p>
          </article>
        </div>

        <div className="data-browser-toolbar" role="toolbar" aria-label="Archive dataset browser">
          <div className="dataset-chip-row" role="tablist" aria-label="Archive dataset">
            {datasetSummaries.map((dataset) => (
              <button
                key={dataset.dataset}
                className={`dataset-chip ${selectedDataset === dataset.dataset ? 'dataset-chip-active' : ''}`}
                type="button"
                role="tab"
                aria-selected={selectedDataset === dataset.dataset}
                onClick={() => onDatasetChange(dataset.dataset)}
              >
                <span>{dataset.label}</span>
                <strong>{dataset.count}</strong>
              </button>
            ))}
          </div>
        </div>

        <p className="summary-copy data-explorer-summary">
          {datasetSummaries.find((dataset) => dataset.dataset === selectedDataset)?.description ??
            'Browse the normalized PBInfo datasets captured in the canonical snapshot.'}
        </p>
      </div>

      <div className="data-explorer-grid">
        <article className="summary-card data-list-card">
          <div className="data-list-toolbar">
            <label className="field">
              <span>Search current dataset</span>
              <input
                aria-label="Search current dataset"
                value={archiveQuery}
                onChange={(event) => onArchiveQueryChange(event.target.value)}
                placeholder="Search by id, title, user, language, route…"
              />
            </label>
            <span className="panel-chip">{listing?.totalCount ?? 0} records</span>
          </div>

          {listing && listing.items.length > 0 ? (
            <div className="data-record-list" role="list">
              {listing.items.map((item) => (
                <button
                  key={item.recordId}
                  className={`data-record-button ${selectedRecordId === item.recordId ? 'data-record-button-active' : ''}`}
                  type="button"
                  role="listitem"
                  onClick={() => onSelectRecord(item.recordId)}
                >
                  <strong>{item.title}</strong>
                  {item.subtitle ? <span>{item.subtitle}</span> : null}
                  {item.description ? <small>{item.description}</small> : null}
                </button>
              ))}
            </div>
          ) : (
            <p className="summary-copy">
              No records are available for this dataset in the selected snapshot.
            </p>
          )}
        </article>

        <article className="summary-card data-detail-card">
          {detail ? (
            <>
              <div className="panel-heading compact-panel-heading">
                <div>
                  <p className="section-kicker">Selected record</p>
                  <h3>{detail.title}</h3>
                  {detail.subtitle ? <p className="summary-copy">{detail.subtitle}</p> : null}
                </div>
                <span className="panel-chip">{detail.recordId}</span>
              </div>
              <div className="button-row">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => void onOpenPath(detail.filePath)}
                >
                  Open selected record file
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  disabled={!liveMirrorRecordUrl}
                  onClick={() => {
                    if (liveMirrorRecordUrl) {
                      void onOpenExternal(liveMirrorRecordUrl);
                    }
                  }}
                >
                  Open record route in live mirror
                </button>
              </div>
              {detail.mirrorRoute ? (
                <p className="summary-copy">
                  Mirror route: <span className="mono">{detail.mirrorRoute}</span>
                </p>
              ) : null}
              <p className="summary-copy">
                Source file: <span className="mono">{detail.filePath}</span>
              </p>
              <pre className="data-json-viewer">{JSON.stringify(detail.payload, null, 2)}</pre>
            </>
          ) : (
            <p className="summary-copy">
              Select a record to inspect the normalized JSON payload and local mirror linkage.
            </p>
          )}
        </article>
      </div>
    </section>
  );
}
