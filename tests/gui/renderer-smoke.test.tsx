import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';

import { App } from '../../src/gui/renderer/app.js';
import { createBridgeHarness } from './_helpers/desktop-bridge-harness.js';

afterEach(() => {
  cleanup();
});

test('renders the simplified easy-mode overview before exposing deeper tools', { timeout: 60_000 }, async () => {
  const harness = createBridgeHarness();
  render(<App desktop={harness.bridge} />);

  expect(await screen.findByRole('heading', { name: 'Problem Archive Crawler' })).toBeInTheDocument();
  expect(await screen.findByText('PBInfo archival operator console')).toBeInTheDocument();
  expect(await screen.findByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  expect(await screen.findByRole('tab', { name: 'Coverage' })).toBeInTheDocument();
  expect(await screen.findByRole('tab', { name: 'Data' })).toBeInTheDocument();
  expect(await screen.findByRole('tab', { name: 'Setup' })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Archive Overview' })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Problem Status Board' })).toBeInTheDocument();
  const boardToolbar = await screen.findByRole('toolbar', {
    name: 'Problem status board filters',
  });
  expect(within(boardToolbar).getByRole('button', { name: 'Missing official source' })).toBeInTheDocument();
  expect(within(boardToolbar).getByRole('button', { name: 'Missing your source' })).toBeInTheDocument();
  expect(await screen.findByText('Upstream unavailable')).toBeInTheDocument();
  expect(await screen.findByText(/12 official and 8 tests/i)).toBeInTheDocument();
  expect(await screen.findByText('C:/archive-workspace')).toBeInTheDocument();
  expect(await screen.findByText('Primary account')).toBeInTheDocument();
  expect(await screen.findByText('42 pending')).toBeInTheDocument();
  expect(await screen.findByText(/7m remaining/i)).toBeInTheDocument();
  expect(await screen.findByText(/6.0 completed\/min/i)).toBeInTheDocument();
  expect(await screen.findByLabelText('Crawl mode')).toHaveValue('incremental');
  expect(await screen.findByRole('button', { name: /Start full crawl/i })).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: 'Open in browser' })).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: 'Show embedded preview' })).toBeInTheDocument();
  expect(screen.queryByTitle('Mirror preview')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Coverage Explorer' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Data Explorer' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Profiles & Access' })).not.toBeInTheDocument();
  expect(await screen.findByText(/publish --snapshot acceptance-20260310b/)).toBeInTheDocument();
});

test('lets the user move through overview, coverage, data, and setup without overload', { timeout: 60_000 }, async () => {
  const harness = createBridgeHarness();
  render(<App desktop={harness.bridge} />);

  const crawlModeSelect = await screen.findByLabelText('Crawl mode');
  fireEvent.click(await screen.findByRole('button', { name: /Start full crawl/i }));
  expect(await screen.findByText('Started all crawl')).toBeInTheDocument();
  fireEvent.change(crawlModeSelect, {
    target: {
      value: 'fresh',
    },
  });
  expect(crawlModeSelect).toHaveValue('fresh');
  fireEvent.click(await screen.findByRole('button', { name: /Start public crawl/i }));
  expect(await screen.findByText('Started public crawl')).toBeInTheDocument();

  const boardToolbar = await screen.findByRole('toolbar', {
    name: 'Problem status board filters',
  });
  fireEvent.click(within(boardToolbar).getByRole('button', { name: 'Missing your source' }));
  expect(await screen.findByText('Your source missing')).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Open mirror' }));
  expect(harness.openExternal).toHaveBeenCalledWith(
    'http://127.0.0.1:43111/probleme/3716/crossword',
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Open coverage detail' }));
  expect(await screen.findByRole('heading', { name: 'Coverage Explorer' })).toBeInTheDocument();

  fireEvent.click(await screen.findByRole('tab', { name: 'Overview' }));
  const refreshedBoardToolbar = await screen.findByRole('toolbar', {
    name: 'Problem status board filters',
  });
  fireEvent.click(within(refreshedBoardToolbar).getByRole('button', { name: 'Missing tests' }));
  expect(await screen.findByText('Tests not captured yet')).toBeInTheDocument();

  fireEvent.click(await screen.findByRole('button', { name: 'Show embedded preview' }));
  expect(await screen.findByTitle('Mirror preview')).toBeInTheDocument();

  fireEvent.click(await screen.findByRole('tab', { name: 'Coverage' }));
  const coverageHeading = await screen.findByRole('heading', { name: 'Coverage Explorer' });
  const coverageWorkspace = coverageHeading.closest('section');
  expect(coverageWorkspace).toHaveClass('panel-workspace');
  expect(
    within(coverageWorkspace as HTMLElement).getByRole('toolbar', { name: 'Coverage filters' }),
  ).toBeInTheDocument();
  expect(within(coverageWorkspace as HTMLElement).getByLabelText('Tests status')).toBeInTheDocument();
  expect(within(coverageWorkspace as HTMLElement).getByLabelText('Archive state')).toBeInTheDocument();
  fireEvent.change(await screen.findByLabelText('Tests status'), {
    target: {
      value: 'all',
    },
  });
  const coverageSearchInput = await screen.findByLabelText('Search problems');
  fireEvent.change(coverageSearchInput, {
    target: {
      value: 'crossword',
    },
  });
  expect((await screen.findAllByText(/Crossword/i)).length).toBeGreaterThanOrEqual(1);
  expect(await screen.findByText('Required solved languages')).toBeInTheDocument();
  expect(await screen.findByText('Official source not captured yet')).toBeInTheDocument();
  const solvedSelect = await screen.findByLabelText('Solved');
  fireEvent.change(solvedSelect, {
    target: {
      value: 'solved',
    },
  });
  expect((await screen.findAllByText('Solved')).length).toBeGreaterThanOrEqual(1);
  fireEvent.click(await screen.findByRole('button', { name: 'Open coverage record' }));
  expect(harness.openPath).toHaveBeenCalledWith(
    'C:/archive-workspace/archive/snapshots/acceptance-20260310b/normalized/problem-coverage/problem-3716.json',
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Open source list upstream' }));
  expect(harness.openExternal).toHaveBeenCalledWith(
    'https://www.pbinfo.ro/solutii/problema/3716/crossword',
  );

  fireEvent.click(await screen.findByRole('tab', { name: 'Data' }));
  const dataHeading = await screen.findByRole('heading', { name: 'Data Explorer' });
  const dataWorkspace = dataHeading.closest('section');
  expect(dataWorkspace).toHaveClass('panel-workspace');
  expect(
    within(dataWorkspace as HTMLElement).getByRole('toolbar', {
      name: 'Archive dataset browser',
    }),
  ).toBeInTheDocument();
  const datasetSearchInput = await screen.findByLabelText('Search current dataset');
  fireEvent.change(datasetSearchInput, {
    target: {
      value: 'waterreserve',
    },
  });
  expect((await screen.findAllByText('/probleme/3171/problem-3171')).length).toBeGreaterThanOrEqual(1);
  fireEvent.click(await screen.findByRole('button', { name: 'Open normalized archive folder' }));
  expect(harness.openPath).toHaveBeenCalledWith(
    'C:/archive-workspace/archive/snapshots/acceptance-20260310b/normalized',
  );

  fireEvent.click(await screen.findByRole('tab', { name: 'Setup' }));
  expect(await screen.findByRole('heading', { name: 'Profiles & Access' })).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: 'Advanced Settings' })).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Advanced Settings' }));
  expect(await screen.findByRole('heading', { name: 'Advanced Settings' })).toBeInTheDocument();
});

