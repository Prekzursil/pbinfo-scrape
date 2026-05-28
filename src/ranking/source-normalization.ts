import { createHash } from 'node:crypto';

export interface SourceSignature {
  sourceHash: string;
  normalizedSourceHash?: string;
  sourceLength: number;
  normalizedSourceLength?: number;
}

export function buildSourceSignature(
  sourceCode: string | undefined,
  language?: string,
): SourceSignature | undefined {
  if (!sourceCode) {
    return undefined;
  }

  const normalized = normalizeSourceCode(sourceCode, language);
  return {
    sourceHash: sha256(sourceCode),
    normalizedSourceHash: normalized ? sha256(normalized) : undefined,
    sourceLength: sourceCode.length,
    normalizedSourceLength: normalized ? normalized.length : undefined,
  };
}

export function normalizeSourceCode(
  sourceCode: string | undefined,
  language?: string,
): string | undefined {
  if (!sourceCode) {
    return undefined;
  }

  const normalizedLanguage = normalizeLanguage(language);
  let normalized = sourceCode.replace(/\r\n?/gu, '\n');

  if (normalizedLanguage === 'py') {
    normalized = normalized.replace(/^\s*#.*$/gmu, '');
  } else {
    normalized = normalized.replace(/\/\/.*$/gmu, '');
  }

  normalized = normalized.replace(/\/\*[\s\S]*?\*\//gu, '');
  normalized = normalized.replace(/^\s*\{.*?\}\s*$/gmu, '');
  normalized = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\s+/gu, ' ')
    .trim();

  return normalized || undefined;
}

interface LanguageAlias {
  readonly canonical: string;
  readonly substrings?: readonly string[];
  readonly exact?: readonly string[];
}

const LANGUAGE_ALIASES: readonly LanguageAlias[] = [
  { canonical: 'cpp', substrings: ['c++'], exact: ['cpp'] },
  { canonical: 'py', substrings: ['python'], exact: ['py', 'py3'] },
  { canonical: 'csharp', substrings: ['c#', 'csharp'] },
  { canonical: 'pas', substrings: ['pascal'], exact: ['pas'] },
];

function matchesAlias(value: string, alias: LanguageAlias): boolean {
  if (alias.exact?.includes(value)) {
    return true;
  }
  return Boolean(alias.substrings?.some((needle) => value.includes(needle)));
}

export function normalizeLanguage(language?: string): string | undefined {
  const normalized = language?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const match = LANGUAGE_ALIASES.find((alias) => matchesAlias(normalized, alias));
  return match ? match.canonical : normalized;
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
