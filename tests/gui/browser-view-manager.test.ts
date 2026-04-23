import { describe, expect, test } from 'vitest';

import {
  BrowserViewManager,
  extractProblemIdFromUrl,
  type BrowserViewHandle,
  type BrowserViewRuntime,
} from '../../src/gui/main/browser-view-manager.js';

function createMockRuntime(): {
  runtime: BrowserViewRuntime;
  loadedUrls: string[];
  externalUrls: string[];
  executedScripts: string[];
  handle: BrowserViewHandle;
  triggerFinishLoad: (url: string) => void;
  triggerWillNavigate: (url: string) => 'allow' | 'deny' | undefined;
  triggerWindowOpen: (url: string) => 'allow' | 'deny' | undefined;
  boundsHistory: Array<{ x: number; y: number; width: number; height: number }>;
  created: boolean;
  attached: boolean;
  canGoBackValue: boolean;
} {
  const loadedUrls: string[] = [];
  const externalUrls: string[] = [];
  const executedScripts: string[] = [];
  const boundsHistory: Array<{ x: number; y: number; width: number; height: number }> = [];
  let willNavigateListener: ((url: string) => 'allow' | 'deny') | null = null;
  let windowOpenListener: ((url: string) => 'allow' | 'deny') | null = null;
  let didFinishLoadListener: ((url: string) => void) | null = null;
  let currentUrl = '';
  let canGoBackValue = false;
  let canGoForwardValue = false;
  let created = false;
  let attached = false;

  const handle: BrowserViewHandle = {
    setBounds: (bounds) => {
      boundsHistory.push(bounds);
    },
    loadURL: async (url) => {
      loadedUrls.push(url);
      currentUrl = url;
    },
    goBack: () => {
      canGoBackValue = false;
    },
    goForward: () => {
      canGoForwardValue = false;
    },
    reload: () => {},
    getURL: () => currentUrl,
    canGoBack: () => canGoBackValue,
    canGoForward: () => canGoForwardValue,
    executeJavaScript: async (script) => {
      executedScripts.push(script);
      return null;
    },
    onWillNavigate: (listener) => {
      willNavigateListener = listener;
    },
    onWindowOpen: (listener) => {
      windowOpenListener = listener;
    },
    onDidFinishLoad: (listener) => {
      didFinishLoadListener = listener;
    },
  };

  const runtime: BrowserViewRuntime = {
    createView: () => {
      created = true;
      return handle;
    },
    attachToWindow: () => {
      attached = true;
    },
    removeFromWindow: () => {
      attached = false;
    },
    shellOpenExternal: async (url) => {
      externalUrls.push(url);
    },
  };

  return {
    runtime,
    loadedUrls,
    externalUrls,
    executedScripts,
    handle,
    triggerFinishLoad: (url) => didFinishLoadListener?.(url),
    triggerWillNavigate: (url) => willNavigateListener?.(url),
    triggerWindowOpen: (url) => windowOpenListener?.(url),
    boundsHistory,
    get created() {
      return created;
    },
    get attached() {
      return attached;
    },
    get canGoBackValue() {
      return canGoBackValue;
    },
  };
}

describe('extractProblemIdFromUrl', () => {
  test('extracts problem id from mirror URLs', () => {
    expect(extractProblemIdFromUrl('http://127.0.0.1:4173/probleme/3171/waterreserve')).toBe(3171);
  });

  test('returns null for non-problem URLs', () => {
    expect(extractProblemIdFromUrl('http://127.0.0.1:4173/profil/Prekzursil')).toBeNull();
    expect(extractProblemIdFromUrl('about:blank')).toBeNull();
    expect(extractProblemIdFromUrl('not-a-url')).toBeNull();
  });
});

describe('BrowserViewManager', () => {
  test('attaches and navigates within the allowed origin', async () => {
    const mock = createMockRuntime();
    const manager = new BrowserViewManager({
      runtime: mock.runtime,
      allowedOrigins: ['http://127.0.0.1:4173'],
    });

    await manager.navigate('http://127.0.0.1:4173/probleme/3171/waterreserve');

    expect(mock.created).toBe(true);
    expect(mock.attached).toBe(true);
    expect(mock.loadedUrls).toEqual(['http://127.0.0.1:4173/probleme/3171/waterreserve']);
  });

  test('will-navigate to off-origin URLs opens external browser and blocks the navigation', () => {
    const mock = createMockRuntime();
    const manager = new BrowserViewManager({
      runtime: mock.runtime,
      allowedOrigins: ['http://127.0.0.1:4173'],
    });
    manager.attach();
    const decision = mock.triggerWillNavigate('https://github.com/foo');
    expect(decision).toBe('deny');
    expect(mock.externalUrls).toEqual(['https://github.com/foo']);
  });

  test('will-navigate to a mirror-gap URL redirects to the archive-truth fallback', () => {
    const mock = createMockRuntime();
    const manager = new BrowserViewManager({
      runtime: mock.runtime,
      allowedOrigins: ['http://127.0.0.1:4173'],
      resolveArchiveTruthForNavigation: (url) =>
        url.includes('/probleme/999999')
          ? 'http://127.0.0.1:4173/__not-archived?original=' + encodeURIComponent(url)
          : undefined,
    });
    manager.attach();
    const decision = mock.triggerWillNavigate('http://127.0.0.1:4173/probleme/999999/missing');
    expect(decision).toBe('deny');
    expect(mock.loadedUrls).toEqual([
      'http://127.0.0.1:4173/__not-archived?original=' +
        encodeURIComponent('http://127.0.0.1:4173/probleme/999999/missing'),
    ]);
  });

  test('window-open for off-origin URLs routes to external browser instead', () => {
    const mock = createMockRuntime();
    const manager = new BrowserViewManager({
      runtime: mock.runtime,
      allowedOrigins: ['http://127.0.0.1:4173'],
    });
    manager.attach();
    const decision = mock.triggerWindowOpen('https://pbinfo.ro/contact');
    expect(decision).toBe('deny');
    expect(mock.externalUrls).toEqual(['https://pbinfo.ro/contact']);
  });

  test('did-finish-load on a problem URL injects the overlay script', () => {
    const mock = createMockRuntime();
    const manager = new BrowserViewManager({
      runtime: mock.runtime,
      allowedOrigins: ['http://127.0.0.1:4173'],
    });
    manager.attach();
    mock.triggerFinishLoad('http://127.0.0.1:4173/probleme/3171/waterreserve');
    expect(mock.executedScripts).toHaveLength(1);
    expect(mock.executedScripts[0]).toContain('pbinfoOverlayInjected');
    expect(mock.executedScripts[0]).toContain('__pbinfo-overlay.json?problemId=');
  });

  test('did-finish-load on a non-problem URL does NOT inject the overlay', () => {
    const mock = createMockRuntime();
    const manager = new BrowserViewManager({
      runtime: mock.runtime,
      allowedOrigins: ['http://127.0.0.1:4173'],
    });
    manager.attach();
    mock.triggerFinishLoad('http://127.0.0.1:4173/profil/Prekzursil');
    expect(mock.executedScripts).toHaveLength(0);
  });

  test('snapshot reports current url + navigation availability', () => {
    const mock = createMockRuntime();
    const manager = new BrowserViewManager({
      runtime: mock.runtime,
      allowedOrigins: ['http://127.0.0.1:4173'],
    });
    expect(manager.snapshot()).toEqual({ url: '', canGoBack: false, canGoForward: false });
    manager.attach();
    expect(manager.snapshot()).toEqual({ url: '', canGoBack: false, canGoForward: false });
  });

  test('detach removes the view from the host window', () => {
    const mock = createMockRuntime();
    const manager = new BrowserViewManager({
      runtime: mock.runtime,
      allowedOrigins: ['http://127.0.0.1:4173'],
    });
    manager.attach();
    expect(mock.attached).toBe(true);
    manager.detach();
    expect(mock.attached).toBe(false);
  });
});
