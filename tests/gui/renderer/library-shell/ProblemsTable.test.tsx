import '@testing-library/jest-dom/vitest';

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

import { ProblemsTable } from '../../../../src/gui/renderer/library-shell/ProblemsTable.js';
import type { ProblemRowInput } from '../../../../src/gui/main/library-repository.js';

afterEach(() => {
  cleanup();
});

function makeRow(id: string): ProblemRowInput {
  return {
    id,
    name: `problem-${id}`,
    slug: `problem-${id}`,
    grade: 9,
    tags: [],
    progress: 'not-attempted',
    bestScore: 0,
    completeness: 'never-crawled',
    pillars: {
      statement: 'missing',
      editorial: 'missing',
      officialSource: 'missing',
      mySource: 'not-applicable',
      tests: 'missing',
    },
    languagesTried: [],
  };
}

function baseProps() {
  return {
    focusSearch: vi.fn(),
    focusFilters: vi.fn(),
    onEscape: vi.fn(),
  };
}

describe('<ProblemsTable>', () => {
  test('renders at most ~40 rows in the DOM for a 2500-row input', () => {
    const rows = Array.from({ length: 2500 }, (_, i) => makeRow(String(i + 1)));
    const { container } = render(
      <ProblemsTable
        rows={rows}
        selectedId={undefined}
        onOpenRow={vi.fn()}
        {...baseProps()}
      />,
    );
    const rendered = container.querySelectorAll('[data-testid^="problem-row-"]');
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThanOrEqual(40);
  });

  test('renders all rows when input is small', () => {
    const rows = Array.from({ length: 4 }, (_, i) => makeRow(String(i + 1)));
    const { container } = render(
      <ProblemsTable
        rows={rows}
        selectedId={undefined}
        onOpenRow={vi.fn()}
        {...baseProps()}
      />,
    );
    expect(
      container.querySelectorAll('[data-testid^="problem-row-"]'),
    ).toHaveLength(4);
  });

  test('renders empty state when there are no rows', () => {
    const { getByText } = render(
      <ProblemsTable
        rows={[]}
        selectedId={undefined}
        onOpenRow={vi.fn()}
        {...baseProps()}
      />,
    );
    expect(getByText(/no problems match/i)).toBeInTheDocument();
  });

  test('Ctrl+F triggers focusSearch', () => {
    const focusSearch = vi.fn();
    render(
      <ProblemsTable
        rows={[makeRow('1')]}
        selectedId="1"
        onOpenRow={vi.fn()}
        focusSearch={focusSearch}
        focusFilters={vi.fn()}
        onEscape={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    expect(focusSearch).toHaveBeenCalled();
  });

  test('Ctrl+L triggers focusFilters', () => {
    const focusFilters = vi.fn();
    render(
      <ProblemsTable
        rows={[makeRow('1')]}
        selectedId="1"
        onOpenRow={vi.fn()}
        focusSearch={vi.fn()}
        focusFilters={focusFilters}
        onEscape={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true });
    expect(focusFilters).toHaveBeenCalled();
  });

  test('Escape triggers onEscape', () => {
    const onEscape = vi.fn();
    render(
      <ProblemsTable
        rows={[makeRow('1')]}
        selectedId="1"
        onOpenRow={vi.fn()}
        focusSearch={vi.fn()}
        focusFilters={vi.fn()}
        onEscape={onEscape}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalled();
  });

  test('ArrowDown + Enter opens the next row', () => {
    const onOpen = vi.fn();
    const rows = ['100', '101', '102'].map(makeRow);
    render(
      <ProblemsTable
        rows={rows}
        selectedId="100"
        onOpenRow={onOpen}
        focusSearch={vi.fn()}
        focusFilters={vi.fn()}
        onEscape={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith('101');
  });

  test('ArrowUp at top stays at top', () => {
    const onOpen = vi.fn();
    const rows = ['100', '101'].map(makeRow);
    render(
      <ProblemsTable
        rows={rows}
        selectedId="100"
        onOpenRow={onOpen}
        focusSearch={vi.fn()}
        focusFilters={vi.fn()}
        onEscape={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith('100');
  });
});
