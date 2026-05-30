/**
 * Covers remaining branches in src/gui/renderer/data-explorer.tsx:
 *   - line 241: "Open selected record file" button renders (detail is non-null)
 *   - lines 253-256: "Open record route in live mirror" button click with liveMirrorRecordUrl
 *   - line 265: {detail.mirrorRoute ? ...} truthy branch rendering mirror route text
 */
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { DataExplorerPanel } from '../../src/gui/renderer/data-explorer.js';
import type { GuiArchiveRecordDetail } from '../../src/gui/shared/types.js';

afterEach(() => {
  cleanup();
});

const baseProps = {
  snapshotId: 'test-snap',
  datasetSummaries: [],
  selectedDataset: 'problems' as const,
  selectedRecordId: null,
  archiveQuery: '',
  listing: null,
  onDatasetChange: vi.fn(),
  onArchiveQueryChange: vi.fn(),
  onSelectRecord: vi.fn(),
};

function makeDetail(mirrorRoute?: string): GuiArchiveRecordDetail {
  return {
    snapshotId: 'test-snap',
    dataset: 'problems',
    recordId: 'problem-42',
    title: 'Problem 42',
    subtitle: 'A test problem',
    filePath: 'C:/ws/normalized/problems/problem-42.json',
    mirrorRoute,
    payload: { id: 42 },
  };
}

describe('DataRecordDetail with mirrorRoute (lines 241, 253-256, 265)', () => {
  test('renders Open selected record file button (line 241) and mirror route text (line 265)', () => {
    const onOpenPath = vi.fn(async () => undefined);
    const onOpenExternal = vi.fn(async () => undefined);
    const detail = makeDetail('/probleme/42/test');

    render(
      <DataExplorerPanel
        {...baseProps}
        detail={detail}
        onOpenPath={onOpenPath}
        onOpenExternal={onOpenExternal}
      />,
    );

    // line 241: "Open selected record file" button is rendered when detail is non-null
    expect(screen.getByRole('button', { name: 'Open selected record file' })).toBeInTheDocument();

    // line 265: mirrorRoute truthy branch renders the mirror route text
    expect(screen.getByText('/probleme/42/test')).toBeInTheDocument();
  });

  test('clicking Open selected record file calls onOpenPath (line 244)', async () => {
    const onOpenPath = vi.fn(async () => undefined);
    const detail = makeDetail('/probleme/42/test');

    render(
      <DataExplorerPanel
        {...baseProps}
        detail={detail}
        onOpenPath={onOpenPath}
        onOpenExternal={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open selected record file' }));
    await vi.waitFor(() =>
      expect(onOpenPath).toHaveBeenCalledWith('C:/ws/normalized/problems/problem-42.json'),
    );
  });

  test('clicking Open record route calls onOpenExternal when liveMirrorRecordUrl exists (lines 253-256)', async () => {
    const onOpenExternal = vi.fn(async () => undefined);
    const detail = makeDetail('/probleme/42/test');

    render(
      <DataExplorerPanel
        {...baseProps}
        detail={detail}
        previewUrl="http://127.0.0.1:4173/"
        onOpenPath={vi.fn()}
        onOpenExternal={onOpenExternal}
      />,
    );

    const openMirrorButton = screen.getByRole('button', { name: 'Open record route in live mirror' });
    expect(openMirrorButton).not.toBeDisabled();
    fireEvent.click(openMirrorButton);

    await vi.waitFor(() =>
      expect(onOpenExternal).toHaveBeenCalledWith(
        'http://127.0.0.1:4173/probleme/42/test',
      ),
    );
  });
});
