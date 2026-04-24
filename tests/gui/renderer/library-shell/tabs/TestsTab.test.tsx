import '@testing-library/jest-dom/vitest';

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { TestsTab } from '../../../../../src/gui/renderer/library-shell/tabs/TestsTab.js';

afterEach(() => {
  cleanup();
});

const fixture = {
  folderPath: '/archive/tests/100-notwen',
  cases: [
    {
      id: '1',
      kind: 'example' as const,
      inputBody: '1 2',
      expectedBody: '3',
    },
    {
      id: '2',
      kind: 'visible' as const,
      inputBody: '10 20',
      expectedBody: '30',
      evaluationVerdicts: { cpp: 'AC' },
    },
  ],
};

function makeBridge() {
  return {
    shell: {
      openPath: vi.fn(),
      copyToClipboard: vi.fn(),
    },
  } as unknown as Parameters<typeof TestsTab>[0]['bridge'];
}

describe('<TestsTab>', () => {
  test('renders each case with input + expected + kind chip', () => {
    render(<TestsTab bridge={makeBridge()} tests={fixture} />);
    expect(screen.getByText('1 2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('10 20')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getAllByText(/example|visible/i).length).toBeGreaterThanOrEqual(2);
  });

  test('renders verdict chips when evaluationVerdicts is present', () => {
    render(<TestsTab bridge={makeBridge()} tests={fixture} />);
    expect(screen.getByText(/cpp.*AC/i)).toBeInTheDocument();
  });

  test('Open folder button calls shell.openPath with folderPath', () => {
    const bridge = makeBridge();
    render(<TestsTab bridge={bridge} tests={fixture} />);
    fireEvent.click(screen.getByRole('button', { name: /open folder/i }));
    expect(bridge.shell.openPath).toHaveBeenCalledWith(fixture.folderPath);
  });

  test('Copy input button copies case input body', () => {
    const bridge = makeBridge();
    render(<TestsTab bridge={bridge} tests={fixture} />);
    fireEvent.click(screen.getAllByRole('button', { name: /copy input/i })[0]!);
    expect(bridge.shell.copyToClipboard).toHaveBeenCalledWith('1 2');
  });

  test('Copy expected button copies case expected body', () => {
    const bridge = makeBridge();
    render(<TestsTab bridge={bridge} tests={fixture} />);
    fireEvent.click(
      screen.getAllByRole('button', { name: /copy expected/i })[0]!,
    );
    expect(bridge.shell.copyToClipboard).toHaveBeenCalledWith('3');
  });

  test('renders empty state when no cases', () => {
    render(
      <TestsTab
        bridge={makeBridge()}
        tests={{ folderPath: '/x', cases: [] }}
      />,
    );
    expect(screen.getByText(/no test cases/i)).toBeInTheDocument();
  });
});
