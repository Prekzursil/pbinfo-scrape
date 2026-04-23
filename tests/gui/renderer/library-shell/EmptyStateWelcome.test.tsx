import '@testing-library/jest-dom/vitest';

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';

import { EmptyStateWelcome } from '../../../../src/gui/renderer/library-shell/EmptyStateWelcome.js';

afterEach(() => {
  cleanup();
});

describe('<EmptyStateWelcome>', () => {
  test('renders the welcome heading and both primary actions', () => {
    render(
      <EmptyStateWelcome
        probedPaths={['/a', '/b', '/c']}
        onRunInitialCrawl={vi.fn()}
        onBrowseForArchive={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /welcome to problem archive crawler/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /run the initial crawl/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /browse for archive/i }),
    ).toBeInTheDocument();
  });

  test('lists every probed path so the user understands where we looked', () => {
    render(
      <EmptyStateWelcome
        probedPaths={[
          '/a/archive',
          '/b/resources/archive',
          '/c/archive',
        ]}
        onRunInitialCrawl={vi.fn()}
        onBrowseForArchive={vi.fn()}
      />,
    );

    for (const probe of [
      '/a/archive',
      '/b/resources/archive',
      '/c/archive',
    ]) {
      expect(screen.getByText(probe)).toBeInTheDocument();
    }
  });

  test('invokes callbacks on click', () => {
    const runInitial = vi.fn();
    const browse = vi.fn();
    render(
      <EmptyStateWelcome
        probedPaths={['/a']}
        onRunInitialCrawl={runInitial}
        onBrowseForArchive={browse}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: /run the initial crawl/i }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /browse for archive/i }),
    );

    expect(runInitial).toHaveBeenCalledTimes(1);
    expect(browse).toHaveBeenCalledTimes(1);
  });
});
