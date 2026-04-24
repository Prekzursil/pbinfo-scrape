import '@testing-library/jest-dom/vitest';

import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { OperatorMenu } from '../../../../src/gui/renderer/library-shell/OperatorMenu.js';
import type { DesktopBridge } from '../../../../src/gui/shared/bridge.js';

afterEach(() => {
  cleanup();
});

function makeBridge(overrides?: Partial<DesktopBridge['operator']>) {
  let progressCb: ((event: unknown) => void) | undefined;
  const operator = {
    runFullRefresh: vi.fn(),
    runFullRefreshCancel: vi.fn(),
    onProgress: vi.fn((cb: (event: unknown) => void) => {
      progressCb = cb;
      return () => {
        progressCb = undefined;
      };
    }),
    login: vi.fn(),
    openLiveSiteViewer: vi.fn(),
    ...overrides,
  } as DesktopBridge['operator'];
  const bridge = { operator } as unknown as DesktopBridge;
  return {
    bridge,
    emitProgress: (event: unknown) => progressCb?.(event),
  };
}

describe('<OperatorMenu>', () => {
  test('renders an "Operator ▾" trigger button with the dropdown closed', () => {
    const { bridge } = makeBridge();
    render(
      <OperatorMenu
        bridge={bridge}
        onReauthenticate={vi.fn()}
        onRunFullRefresh={vi.fn()}
        onOpenDataExplorer={vi.fn()}
        onOpenLiveSiteViewer={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: /operator/i }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('clicking the trigger opens a role=menu panel with 5 items', () => {
    const { bridge } = makeBridge();
    render(
      <OperatorMenu
        bridge={bridge}
        onReauthenticate={vi.fn()}
        onRunFullRefresh={vi.fn()}
        onOpenDataExplorer={vi.fn()}
        onOpenLiveSiteViewer={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /operator/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(5);
    expect(
      items.some((el) => /re-authenticate/i.test(el.textContent ?? '')),
    ).toBe(true);
    expect(
      items.some((el) => /run full refresh/i.test(el.textContent ?? '')),
    ).toBe(true);
    expect(
      items.some((el) => /open data explorer/i.test(el.textContent ?? '')),
    ).toBe(true);
    expect(
      items.some((el) => /open live-site viewer/i.test(el.textContent ?? '')),
    ).toBe(true);
    expect(items.some((el) => /settings/i.test(el.textContent ?? ''))).toBe(
      true,
    );
  });

  test('each menu item invokes its corresponding callback', () => {
    const callbacks = {
      onReauthenticate: vi.fn(),
      onRunFullRefresh: vi.fn(),
      onOpenDataExplorer: vi.fn(),
      onOpenLiveSiteViewer: vi.fn(),
      onOpenSettings: vi.fn(),
    };
    const { bridge } = makeBridge();
    render(<OperatorMenu bridge={bridge} {...callbacks} />);
    fireEvent.click(screen.getByRole('button', { name: /operator/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /re-authenticate/i }));

    fireEvent.click(screen.getByRole('button', { name: /operator/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /run full refresh/i }));

    fireEvent.click(screen.getByRole('button', { name: /operator/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /open data explorer/i }));

    fireEvent.click(screen.getByRole('button', { name: /operator/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /open live-site viewer/i }));

    fireEvent.click(screen.getByRole('button', { name: /operator/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /settings/i }));

    expect(callbacks.onReauthenticate).toHaveBeenCalled();
    expect(callbacks.onRunFullRefresh).toHaveBeenCalled();
    expect(callbacks.onOpenDataExplorer).toHaveBeenCalled();
    expect(callbacks.onOpenLiveSiteViewer).toHaveBeenCalled();
    expect(callbacks.onOpenSettings).toHaveBeenCalled();
  });

  test('Run full refresh becomes disabled while a job is active', () => {
    const { bridge, emitProgress } = makeBridge();
    render(
      <OperatorMenu
        bridge={bridge}
        onReauthenticate={vi.fn()}
        onRunFullRefresh={vi.fn()}
        onOpenDataExplorer={vi.fn()}
        onOpenLiveSiteViewer={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    act(() =>
      emitProgress({
        jobId: 'job-1',
        phase: 'crawl-list',
        processed: 10,
        total: 100,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /operator/i }));
    const refreshItem = screen.getByRole('menuitem', {
      name: /run full refresh/i,
    });
    expect(refreshItem).toBeDisabled();

    act(() =>
      emitProgress({ jobId: 'job-1', phase: 'finalize', processed: 1, total: 1 }),
    );
    expect(refreshItem).not.toBeDisabled();
  });
});
