export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Electron-side contract used by the BrowserView manager. The app wires the
 * real WebContentsView + shell + session handles in; tests pass stubs.
 */
export interface BrowserViewRuntime {
  createView: () => BrowserViewHandle;
  attachToWindow: (view: BrowserViewHandle) => void;
  removeFromWindow: (view: BrowserViewHandle) => void;
  shellOpenExternal: (url: string) => Promise<void>;
}

export interface BrowserViewHandle {
  setBounds: (bounds: ViewBounds) => void;
  loadURL: (url: string) => Promise<void>;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  getURL: () => string;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  executeJavaScript: (script: string) => Promise<unknown>;
  onWillNavigate: (listener: (url: string) => 'allow' | 'deny') => void;
  onWindowOpen: (listener: (url: string) => 'allow' | 'deny') => void;
  onDidFinishLoad: (listener: (url: string) => void) => void;
}

export interface BrowserViewManagerOptions {
  runtime: BrowserViewRuntime;
  allowedOrigins: readonly string[];
  overlayScript?: (problemId: number) => string;
  resolveArchiveTruthForNavigation?: (url: string) => string | undefined;
}

export interface BrowserViewSnapshot {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

export class BrowserViewManager {
  private readonly runtime: BrowserViewRuntime;
  private readonly allowedOrigins: Set<string>;
  private readonly overlayScript: (problemId: number) => string;
  private readonly resolveArchiveTruthForNavigation?: (url: string) => string | undefined;
  private view: BrowserViewHandle | null = null;

  constructor(options: BrowserViewManagerOptions) {
    this.runtime = options.runtime;
    this.allowedOrigins = new Set(options.allowedOrigins);
    this.overlayScript = options.overlayScript ?? defaultOverlayScript;
    this.resolveArchiveTruthForNavigation = options.resolveArchiveTruthForNavigation;
  }

  attach(): BrowserViewHandle {
    if (this.view) {
      return this.view;
    }
    const view = this.runtime.createView();
    this.runtime.attachToWindow(view);
    view.onWillNavigate((url) => this.handleNavigation(url));
    view.onWindowOpen((url) => this.handleWindowOpen(url));
    view.onDidFinishLoad((finalUrl) => this.injectOverlayIfProblem(finalUrl));
    this.view = view;
    return view;
  }

  detach(): void {
    if (!this.view) {
      return;
    }
    this.runtime.removeFromWindow(this.view);
    this.view = null;
  }

  setBounds(bounds: ViewBounds): void {
    this.view?.setBounds(bounds);
  }

  async navigate(url: string): Promise<void> {
    const view = this.ensureAttached();
    const decision = this.handleNavigation(url);
    if (decision === 'deny') {
      return;
    }
    await view.loadURL(url);
  }

  goBack(): void {
    this.view?.goBack();
  }

  goForward(): void {
    this.view?.goForward();
  }

  reload(): void {
    this.view?.reload();
  }

  snapshot(): BrowserViewSnapshot {
    if (!this.view) {
      return { url: '', canGoBack: false, canGoForward: false };
    }
    return {
      url: this.view.getURL(),
      canGoBack: this.view.canGoBack(),
      canGoForward: this.view.canGoForward(),
    };
  }

  handleNavigation(url: string): 'allow' | 'deny' {
    const origin = safeOrigin(url);
    if (!origin) {
      return 'deny';
    }
    // Archive-truth fallback takes precedence even for in-origin URLs so the
    // viewer can redirect to the "not archived yet" stub before loading a
    // mirror route that would 404 or silently render the wrong page.
    const archiveTruthFallback = this.resolveArchiveTruthForNavigation?.(url);
    if (archiveTruthFallback) {
      void this.view?.loadURL(archiveTruthFallback);
      return 'deny';
    }
    if (this.allowedOrigins.has(origin)) {
      return 'allow';
    }
    void this.runtime.shellOpenExternal(url);
    return 'deny';
  }

  handleWindowOpen(url: string): 'allow' | 'deny' {
    const origin = safeOrigin(url);
    if (origin && this.allowedOrigins.has(origin)) {
      void this.view?.loadURL(url);
    } else {
      void this.runtime.shellOpenExternal(url);
    }
    return 'deny';
  }

  private ensureAttached(): BrowserViewHandle {
    return this.view ?? this.attach();
  }

  private injectOverlayIfProblem(finalUrl: string): void {
    const problemId = extractProblemIdFromUrl(finalUrl);
    if (!problemId || !this.view) {
      return;
    }
    void this.view.executeJavaScript(this.overlayScript(problemId));
  }
}

export function extractProblemIdFromUrl(url: string): number | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/probleme\/(\d+)(?:\/|$)/);
    const id = match?.[1] ? Number(match[1]) : Number.NaN;
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Overlay script that runs inside the mirrored-page WebContents. Uses only
 * createElement + textContent + setAttribute so no HTML string ever reaches
 * the DOM parser — closes the innerHTML/XSS surface even though the overlay
 * payload comes from our own same-origin mirror endpoint.
 */
function defaultOverlayScript(problemId: number): string {
  const encoded = JSON.stringify(problemId);
  return `(() => {
    if (window.__pbinfoOverlayInjected) return;
    window.__pbinfoOverlayInjected = true;
    fetch('/__pbinfo-overlay.json?problemId=' + ${encoded}, { cache: 'no-store' })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!data || !document.body) return;
        const host = document.createElement('aside');
        host.setAttribute('data-pbinfo-overlay', '1');
        host.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;background:rgba(14,16,20,.92);color:#fff;font:12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:12px 14px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.45);max-width:320px;backdrop-filter:blur(4px)';
        const addLine = (label, value) => {
          const row = document.createElement('div');
          const strong = document.createElement('strong');
          strong.textContent = label + ': ';
          row.appendChild(strong);
          row.appendChild(document.createTextNode(value));
          host.appendChild(row);
        };
        addLine('Progress', String(data.progressState));
        addLine('Best score', String(data.bestScore));
        addLine('Evals archived', String(data.evaluationCount));
        addLine('Official', (data.officialSourceLanguages && data.officialSourceLanguages.join(', ')) || 'not archived');
        addLine('Mine', (data.userSourceLanguages && data.userSourceLanguages.join(', ')) || 'not archived');
        addLine('Tests', data.testsCaptured ? 'captured' : 'not captured');
        document.body.appendChild(host);
      })
      .catch(() => {});
  })();`;
}
