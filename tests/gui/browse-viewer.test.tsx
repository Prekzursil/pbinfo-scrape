import '@testing-library/jest-dom/vitest';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  BrowseViewer,
  type BrowseViewerBridge,
  type BrowseViewerSnapshot,
} from '../../src/gui/renderer/browse-viewer.js';

function createBridge(overrides: Partial<BrowseViewerBridge> = {}): BrowseViewerBridge {
  const defaultSnapshot: BrowseViewerSnapshot = {
    url: '',
    canGoBack: false,
    canGoForward: false,
  };
  return {
    attach: vi.fn(async () => defaultSnapshot),
    detach: vi.fn(async () => {}),
    navigate: vi.fn(async (url: string) => ({
      url,
      canGoBack: true,
      canGoForward: false,
    })),
    goBack: vi.fn(async () => ({ ...defaultSnapshot, canGoForward: true })),
    goForward: vi.fn(async () => defaultSnapshot),
    reload: vi.fn(async () => defaultSnapshot),
    setBounds: vi.fn(async () => {}),
    getSnapshot: vi.fn(async () => defaultSnapshot),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('BrowseViewer', () => {
  test('attaches on mount and renders the address bar + nav controls', async () => {
    const bridge = createBridge();
    render(<BrowseViewer bridge={bridge} />);

    await waitFor(() => expect(bridge.attach).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Address bar')).toBeInTheDocument();
    expect(screen.getByLabelText('Go back')).toBeDisabled();
    expect(screen.getByLabelText('Go forward')).toBeDisabled();
  });

  test('navigates to initialUrl on mount', async () => {
    const bridge = createBridge();
    render(<BrowseViewer bridge={bridge} initialUrl="http://127.0.0.1:4173/probleme/1/sum" />);

    await waitFor(() => expect(bridge.navigate).toHaveBeenCalledTimes(1));
    expect(bridge.navigate).toHaveBeenCalledWith('http://127.0.0.1:4173/probleme/1/sum');
  });

  test('submitting the form navigates to the entered URL', async () => {
    const bridge = createBridge();
    render(<BrowseViewer bridge={bridge} />);
    await waitFor(() => expect(bridge.attach).toHaveBeenCalled());

    const input = screen.getByLabelText('Address bar') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'http://127.0.0.1:4173/probleme/42/maxchain' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));

    await waitFor(() =>
      expect(bridge.navigate).toHaveBeenCalledWith(
        'http://127.0.0.1:4173/probleme/42/maxchain',
      ),
    );
  });

  test('back / forward / reload buttons call the bridge', async () => {
    const bridge = createBridge({
      attach: vi.fn(async () => ({ url: 'about:blank', canGoBack: true, canGoForward: true })),
    });
    render(<BrowseViewer bridge={bridge} />);
    await waitFor(() => expect(screen.getByLabelText('Go back')).not.toBeDisabled());

    fireEvent.click(screen.getByLabelText('Go back'));
    await waitFor(() => expect(bridge.goBack).toHaveBeenCalled());

    fireEvent.click(screen.getByLabelText('Go forward'));
    await waitFor(() => expect(bridge.goForward).toHaveBeenCalled());

    fireEvent.click(screen.getByLabelText('Reload'));
    await waitFor(() => expect(bridge.reload).toHaveBeenCalled());
  });

  test('detaches on unmount', async () => {
    const bridge = createBridge();
    const { unmount } = render(<BrowseViewer bridge={bridge} />);
    await waitFor(() => expect(bridge.attach).toHaveBeenCalled());
    unmount();
    expect(bridge.detach).toHaveBeenCalledTimes(1);
  });

  test('shows an error banner when navigate fails', async () => {
    const bridge = createBridge({
      navigate: vi.fn(async () => {
        throw new Error('mirror server unavailable');
      }),
    });
    render(<BrowseViewer bridge={bridge} />);
    await waitFor(() => expect(bridge.attach).toHaveBeenCalled());

    const input = screen.getByLabelText('Address bar') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'http://127.0.0.1:4173/probleme/1/sum' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));

    await waitFor(() =>
      expect(screen.getByText('mirror server unavailable')).toBeInTheDocument(),
    );
  });

  test('empty submit does not call navigate', async () => {
    const bridge = createBridge();
    render(<BrowseViewer bridge={bridge} />);
    await waitFor(() => expect(bridge.attach).toHaveBeenCalled());

    const navigateCallsBefore = (bridge.navigate as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    // No new navigate call because input is empty.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect((bridge.navigate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      navigateCallsBefore,
    );
  });
});
