export interface TopBarProps {
  readonly archiveRoot: string;
  readonly snapshotId: string | undefined;
  readonly totalCount: number;
}

export function TopBar({ archiveRoot, snapshotId, totalCount }: TopBarProps) {
  return (
    <header className="library-shell__topbar" role="banner">
      <h1>Problem Archive Crawler</h1>
      <div className="library-shell__topbar-meta">
        <span className="library-shell__snapshot-chip" title={archiveRoot}>
          {snapshotId ?? 'no snapshot'}
        </span>
        <span className="library-shell__count">{totalCount.toLocaleString()} problems</span>
      </div>
    </header>
  );
}
