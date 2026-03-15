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

export function normalizeLanguage(language?: string): string | undefined {
  const normalized = language?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized.includes('c++') || normalized === 'cpp') {
    return 'cpp';
  }
  if (normalized.includes('python') || normalized === 'py' || normalized === 'py3') {
    return 'py';
  }
  if (normalized.includes('c#') || normalized.includes('csharp')) {
    return 'csharp';
  }
  if (normalized.includes('pascal') || normalized === 'pas') {
    return 'pas';
  }

  return normalized;
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
