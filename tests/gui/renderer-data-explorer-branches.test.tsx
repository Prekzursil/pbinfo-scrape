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

describe('DataExplorerPanel mirror folder/browser buttons and null mirrorRoute branch', () => {
  test('clicking "Open mirror output folder" calls onOpenPath with mirrorRoot (lines 93-96)', async () => {
    const onOpenPath = vi.fn(async () => undefined);
    render(
      <DataExplorerPanel
        {...baseProps}
        mirrorRoot="C:/ws/mirror"
        onOpenPath={onOpenPath}
        onOpenExternal={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open mirror output folder' }));
    await vi.waitFor(() =>
      expect(onOpenPath).toHaveBeenCalledWith('C:/ws/mirror'),
    );
  });

  test('clicking "Open mirror in browser" calls onOpenExternal with mirrorUrl (lines 105-108)', async () => {
    const onOpenExternal = vi.fn(async () => undefined);
    render(
      <DataExplorerPanel
        {...baseProps}
        mirrorUrl="http://127.0.0.1:4174/"
        onOpenPath={vi.fn()}
        onOpenExternal={onOpenExternal}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open mirror in browser' }));
    await vi.waitFor(() =>
      expect(onOpenExternal).toHaveBeenCalledWith('http://127.0.0.1:4174/'),
    );
  });

  test('detail with no mirrorRoute renders null branch (line 265)', () => {
    // When detail.mirrorRoute is undefined, the {detail.mirrorRoute ? ... : null} branch
    // evaluates to null (line 265) and no mirror route text is rendered.
    const detailNoRoute: GuiArchiveRecordDetail = {
      snapshotId: 'test-snap',
      dataset: 'problems',
      recordId: 'problem-99',
      title: 'Problem 99',
      subtitle: 'No route',
      filePath: 'C:/ws/normalized/problems/problem-99.json',
      mirrorRoute: undefined,
      payload: { id: 99 },
    };

    render(
      <DataExplorerPanel
        {...baseProps}
        detail={detailNoRoute}
        onOpenPath={vi.fn()}
        onOpenExternal={vi.fn()}
      />,
    );

    // No mirror route text should be present (null branch)
    expect(screen.queryByText(/Mirror route:/)).not.toBeInTheDocument();
    // But the file path should still be present
    expect(screen.getByText('C:/ws/normalized/problems/problem-99.json')).toBeInTheDocument();
  });
});
