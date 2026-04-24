import type { BundledLanguage, Highlighter } from 'shiki';

export type SupportedTheme = 'light' | 'dark';

const SUPPORTED_LANGS: BundledLanguage[] = [
  'cpp',
  'c',
  'python',
  'pascal',
  'java',
];

const LANG_ALIAS: Record<string, BundledLanguage | undefined> = {
  cpp: 'cpp',
  'c++': 'cpp',
  c: 'c',
  py: 'python',
  python: 'python',
  pas: 'pascal',
  pascal: 'pascal',
  java: 'java',
};

let highlighterPromise: Promise<Highlighter> | undefined;

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then((shiki) =>
      shiki.createHighlighter({
        themes: ['github-light', 'github-dark'],
        langs: [...SUPPORTED_LANGS],
      }),
    );
  }
  return highlighterPromise;
}

export async function highlightCode(
  code: string,
  lang: string,
  theme: SupportedTheme,
): Promise<string> {
  const resolved = LANG_ALIAS[lang.toLowerCase()];
  if (!resolved) {
    return `<pre class="plain-code">${escapeHtml(code)}</pre>`;
  }
  const highlighter = await getHighlighter();
  return highlighter.codeToHtml(code, {
    lang: resolved,
    theme: theme === 'light' ? 'github-light' : 'github-dark',
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}
