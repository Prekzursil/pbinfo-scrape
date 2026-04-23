// Lightweight oklch → linear-sRGB → relative-luminance → WCAG ratio. Self-contained
// to avoid a runtime color library; precision sufficient for AA/AAA gating in tests.

export type Palette = 'light' | 'dark';
export type ParsedTokens = Record<Palette, Record<string, string>>;

// Hardcoded block regexes avoid dynamic RegExp construction (ReDoS risk flagged
// by semgrep on parameterized new RegExp(variable)). Any new theme palette must
// add its selector here explicitly.
const LIGHT_BLOCK_RE = /:root,\s*\[data-theme='light'\]\s*\{([^}]*)\}/u;
const DARK_BLOCK_RE = /\[data-theme='dark'\]\s*\{([^}]*)\}/u;
const DECLARATION_RE = /--([a-z0-9-]+):\s*([^;]+);/iu;

export function parseTokenFile(css: string): ParsedTokens {
  return {
    light: extractBlock(css, LIGHT_BLOCK_RE),
    dark: extractBlock(css, DARK_BLOCK_RE),
  };
}

function extractBlock(css: string, blockRe: RegExp): Record<string, string> {
  const match = css.match(blockRe);
  if (!match || typeof match[1] !== 'string') return {};
  const body = match[1];
  const tokens: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const declaration = line.match(DECLARATION_RE);
    if (
      !declaration ||
      typeof declaration[1] !== 'string' ||
      typeof declaration[2] !== 'string'
    ) {
      continue;
    }
    tokens[`--${declaration[1]}`] = declaration[2].trim();
  }
  return tokens;
}

export function computeContrastRatio(fgExpr: string, bgExpr: string): number {
  const fg = relativeLuminance(oklchToLinearRgb(parseOklch(fgExpr)));
  const bg = relativeLuminance(oklchToLinearRgb(parseOklch(bgExpr)));
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
  readonly alpha: number;
}

function parseOklch(expr: string): Oklch {
  const match = expr.match(
    /oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/u,
  );
  if (
    !match ||
    typeof match[1] !== 'string' ||
    typeof match[2] !== 'string' ||
    typeof match[3] !== 'string'
  ) {
    throw new Error(`Expected oklch(...) expression, got: ${expr}`);
  }
  return {
    l: parseFloat(match[1]) / 100,
    c: parseFloat(match[2]),
    h: parseFloat(match[3]),
    alpha: typeof match[4] === 'string' ? parseFloat(match[4]) : 1,
  };
}

function oklchToLinearRgb({
  l,
  c,
  h,
}: Oklch): { r: number; g: number; b: number } {
  // Convert OKLCH → OKLab
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);
  // OKLab → linear sRGB (see https://bottosson.github.io/posts/oklab/)
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  return {
    r: +4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    g: -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    b: -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  };
}

function relativeLuminance({
  r,
  g,
  b,
}: {
  r: number;
  g: number;
  b: number;
}): number {
  return 0.2126 * clamp01(r) + 0.7152 * clamp01(g) + 0.0722 * clamp01(b);
}

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}
