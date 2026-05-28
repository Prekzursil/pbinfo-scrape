import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const renderSpy = vi.fn<(node: unknown) => void>();
const createRootSpy = vi.fn<(container: Element) => { render: typeof renderSpy }>(() => ({
  render: renderSpy,
}));

vi.mock('react-dom/client', () => ({
  default: { createRoot: (container: Element) => createRootSpy(container) },
  createRoot: (container: Element) => createRootSpy(container),
}));

vi.mock('../../src/gui/renderer/app.js', () => ({
  App: () => null,
}));

// Font and stylesheet side-effect imports are not executable in jsdom.
vi.mock('@fontsource/sora/700.css', () => ({}));
vi.mock('@fontsource/sora/800.css', () => ({}));
vi.mock('@fontsource/manrope/400.css', () => ({}));
vi.mock('@fontsource/manrope/600.css', () => ({}));
vi.mock('@fontsource/ibm-plex-mono/400.css', () => ({}));
vi.mock('@fontsource/ibm-plex-mono/600.css', () => ({}));
vi.mock('../../src/gui/renderer/styles.css', () => ({}));

beforeEach(() => {
  vi.resetModules();
  renderSpy.mockClear();
  createRootSpy.mockClear();
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('renderer bootstrap', () => {
  test('mounts the desktop app into the root element', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);

    await import('../../src/gui/renderer/main.js');

    expect(createRootSpy).toHaveBeenCalledWith(root);
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });

  test('throws when the root element is missing', async () => {
    await expect(import('../../src/gui/renderer/main.js')).rejects.toThrow(
      /root element was not found/i,
    );
  });
});
