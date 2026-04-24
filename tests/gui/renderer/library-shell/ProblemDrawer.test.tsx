import '@testing-library/jest-dom/vitest';

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import { ProblemDrawer } from '../../../../src/gui/renderer/library-shell/ProblemDrawer.js';

afterEach(() => {
  cleanup();
});

function makeDetail(overrides: Record<string, unknown> = {}) {
  return {
    problem: {
      problemId: 100,
      slug: 'notwen',
      name: 'notwen',
      statementHtml: '<p>solve it</p>',
      constraints: [],
    },
    coverage: {
      problemId: 100,
      slug: 'notwen',
      name: 'notwen',
      statementArchived: true,
      officialSourceArchived: true,
      officialSourceStatus: 'archived',
      editorialAvailability: 'visible',
      testsCoverageStatus: 'captured',
      evaluationIds: [],
      userSourceArchived: false,
      userSourceLanguages: [],
    },
    tests: { folderPath: '/a/tests/100-notwen', cases: [] },
    submissions: { evaluations: [], sourceBodies: {} },
    officialSource: { availability: 'archived' },
    editorial: { availability: 'visible' },
    rawPaths: {
      normalized: '/a/100.json',
      coverage: '/a/cov/100.json',
      evaluations: [],
      sources: [],
      rawHtmlPages: [],
    },
    ...overrides,
  };
}

function makeBridge(detail: unknown) {
  return {
    library: {
      listProblems: vi.fn(),
      listTags: vi.fn(),
      getDetail: vi.fn(async () => detail),
    },
  } as unknown as Parameters<typeof ProblemDrawer>[0]['bridge'];
}

describe('<ProblemDrawer>', () => {
  test('returns null when problemId is undefined', () => {
    const { container } = render(
      <ProblemDrawer
        bridge={makeBridge(makeDetail())}
        snapshotId="snap-1"
        problemId={undefined}
        onClose={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  test('fetches detail and renders sticky header with problem id + name', async () => {
    const detail = makeDetail();
    render(
      <ProblemDrawer
        bridge={makeBridge(detail)}
        snapshotId="snap-1"
        problemId="100"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: 'notwen' })).toBeInTheDocument(),
    );
    expect(screen.getByText('#100')).toBeInTheDocument();
  });

  test('renders 6 tab buttons with Statement selected by default', async () => {
    render(
      <ProblemDrawer
        bridge={makeBridge(makeDetail())}
        snapshotId="snap-1"
        problemId="100"
        onClose={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole('tab', { name: 'Statement' }),
      ).toHaveAttribute('aria-selected', 'true'),
    );
    expect(screen.getAllByRole('tab')).toHaveLength(6);
  });

  test('clicking a tab switches active selection', async () => {
    render(
      <ProblemDrawer
        bridge={makeBridge(makeDetail())}
        snapshotId="snap-1"
        problemId="100"
        onClose={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Statement' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Tests' }));
    expect(screen.getByRole('tab', { name: 'Tests' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('close button invokes onClose', async () => {
    const onClose = vi.fn();
    render(
      <ProblemDrawer
        bridge={makeBridge(makeDetail())}
        snapshotId="snap-1"
        problemId="100"
        onClose={onClose}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: 'notwen' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /close problem drawer/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('renders an error banner when getDetail rejects', async () => {
    const bridge = {
      library: {
        listProblems: vi.fn(),
        listTags: vi.fn(),
        getDetail: vi.fn(async () => {
          throw new Error('archive-missing');
        }),
      },
    } as unknown as Parameters<typeof ProblemDrawer>[0]['bridge'];

    render(
      <ProblemDrawer
        bridge={bridge}
        snapshotId="snap-1"
        problemId="100"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('archive-missing'),
    );
  });
});
