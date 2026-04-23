export interface LibraryShellPlaceholderProps {
  readonly archiveRoot: string;
  readonly snapshotId?: string;
}

/**
 * Temporary stub rendered when archive is found but the library-shell branch
 * is behind the dev flag. Replaced by the real LibraryShell in Task 4.
 */
export function LibraryShellPlaceholder(props: LibraryShellPlaceholderProps) {
  return (
    <main data-testid="library-shell-placeholder">
      <h1>Library shell (placeholder — replaced in Task 4)</h1>
      <p>
        Archive: <code>{props.archiveRoot}</code>
      </p>
      {props.snapshotId ? <p>Snapshot: {props.snapshotId}</p> : null}
    </main>
  );
}
