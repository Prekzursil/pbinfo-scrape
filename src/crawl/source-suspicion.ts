interface SuspicionSignals {
  normalized: string;
  compactLength: number;
  readsInput: boolean;
  hasAnyInputLiteralComparisons: boolean;
  hasNonTrivialInputLiteralComparisons: boolean;
  hasIterativeLogic: boolean;
  literalMappingCount: number;
  denseLiteralComparisons: boolean;
}

const LITERAL_MAPPING_BRANCH_PATTERN =
  /\bif\s*\([^)]*(?:==|!=)\s*(?:"[^"\n]{0,32}"|'[^'\n]{0,4}'|-?\d{1,9})[^)]*\)\s*(?:\{)?\s*(?:cout\s*<<\s*(?:"[^"\n]{0,32}"|'[^'\n]{0,4}'|-?\d{1,9})|printf\s*\(\s*(?:"[^"\n]{0,32}"|'[^'\n]{0,4}'|-?\d{1,9})|print\s*\(\s*(?:"[^"\n]{0,32}"|'[^'\n]{0,4}'|-?\d{1,9})|return\s+(?:"[^"\n]{0,32}"|'[^'\n]{0,4}'|-?\d{1,9}))/g;
const LITERAL_MAPPING_CASE_PATTERN =
  /\bcase\s+(?:"[^"\n]{0,32}"|'[^'\n]{0,4}'|-?\d{1,9})\s*:\s*(?:cout\s*<<\s*(?:"[^"\n]{0,32}"|'[^'\n]{0,4}'|-?\d{1,9})|printf\s*\(\s*(?:"[^"\n]{0,32}"|'[^'\n]{0,4}'|-?\d{1,9})|print\s*\(\s*(?:"[^"\n]{0,32}"|'[^'\n]{0,4}'|-?\d{1,9})|return\s+(?:"[^"\n]{0,32}"|'[^'\n]{0,4}'|-?\d{1,9}))/g;

function computeSuspicionSignals(sourceCode: string): SuspicionSignals {
  const normalized = sourceCode.toLowerCase();
  const inputVariables = collectInputVariables(sourceCode);
  const directInputComparisons = collectExactInputLiteralComparisons(normalized, inputVariables);
  const comparisonsByVariable = summarizeComparisonsByVariable(directInputComparisons);
  const switchCaseCount = countSuspiciousSwitchCases(normalized, inputVariables);
  const literalMappingCount =
    (normalized.match(LITERAL_MAPPING_BRANCH_PATTERN) ?? []).length +
    (normalized.match(LITERAL_MAPPING_CASE_PATTERN) ?? []).length;

  return {
    normalized,
    compactLength: normalized.replace(/\s+/g, ' ').trim().length,
    readsInput: detectsInputRead(sourceCode),
    hasAnyInputLiteralComparisons: directInputComparisons.length > 0 || switchCaseCount > 0,
    hasNonTrivialInputLiteralComparisons: comparisonsByVariable.size > 0 || switchCaseCount > 0,
    hasIterativeLogic: /\b(for|while|do)\b/.test(normalized),
    literalMappingCount,
    denseLiteralComparisons:
      [...comparisonsByVariable.values()].some((count) => count >= 4) || switchCaseCount >= 4,
  };
}

function detectsConstantOutput(normalized: string, readsInput: boolean): boolean {
  if (readsInput) {
    return false;
  }
  const printedConstantLiterals = [
    ...normalized.matchAll(/\bcout\s*<<\s*(?:"([^"\n]{0,32})"|'([^'\n]{0,8})'|(-?\d{1,9}))/g),
    ...normalized.matchAll(
      /\b(?:printf|print)\s*\(\s*(?:"([^"\n]{0,32})"|'([^'\n]{0,8})'|(-?\d{1,9}))/g,
    ),
  ];
  return printedConstantLiterals.some((match) =>
    isSubstantiveOutputLiteral(
      match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6],
    ),
  );
}

function branchesViaNonTrivialMapping(signals: SuspicionSignals): boolean {
  return signals.literalMappingCount >= 3 && signals.hasNonTrivialInputLiteralComparisons;
}

function branchesViaDenseComparisons(signals: SuspicionSignals): boolean {
  return (
    signals.denseLiteralComparisons && signals.compactLength < 320 && !signals.hasIterativeLogic
  );
}

function branchesViaCompactMapping(signals: SuspicionSignals): boolean {
  return (
    signals.compactLength < 120 &&
    signals.literalMappingCount >= 1 &&
    signals.hasAnyInputLiteralComparisons &&
    !signals.hasIterativeLogic
  );
}

function branchesViaMediumMapping(signals: SuspicionSignals): boolean {
  return (
    signals.compactLength < 220 &&
    signals.literalMappingCount >= 2 &&
    signals.hasAnyInputLiteralComparisons
  );
}

function detectsInputBranching(signals: SuspicionSignals): boolean {
  if (!signals.readsInput) {
    return false;
  }
  return [
    branchesViaNonTrivialMapping,
    branchesViaDenseComparisons,
    branchesViaCompactMapping,
    branchesViaMediumMapping,
  ].some((predicate) => predicate(signals));
}

function detectsLiteralPairs(signals: SuspicionSignals): boolean {
  return (
    signals.readsInput &&
    signals.hasNonTrivialInputLiteralComparisons &&
    signals.compactLength < 400 &&
    signals.literalMappingCount >= 3
  );
}

function detectsLookupTable(signals: SuspicionSignals): boolean {
  const lookupTableLiterals =
    signals.normalized.match(/\{[^{}]*(?:\d+\s*,\s*){6,}\d+[^{}]*\}/g) ?? [];
  return (
    lookupTableLiterals.length > 0 && signals.compactLength < 300 && !signals.hasIterativeLogic
  );
}

export function detectSuspicionFlags(sourceCode?: string): string[] {
  if (!sourceCode) {
    return [];
  }

  const flags = new Set<string>();
  const signals = computeSuspicionSignals(sourceCode);

  if (signals.normalized.length < 40) {
    flags.add('tiny-source');
  }
  if (detectsConstantOutput(signals.normalized, signals.readsInput)) {
    flags.add('constant-output');
  }
  if (detectsInputBranching(signals)) {
    flags.add('input-branching');
  }
  if (detectsLiteralPairs(signals)) {
    flags.add('literal-pairs');
  }
  if (detectsLookupTable(signals)) {
    flags.add('lookup-table');
  }

  return [...flags];
}

function detectsInputRead(sourceCode: string): boolean {
  return /(cin\s*>>|cin\s*\.\s*get(?:line)?\s*\(|scanf\s*\(|fscanf\s*\(|fread\s*\(|fgetc\s*\(|getchar_unlocked\s*\(|getchar\s*\(|input\s*\(|sys\.stdin(?:\.buffer)?\.(?:read|readline)\s*\(|stdin\.(?:read|readline)\s*\(|std::getline|getline\s*\(|ifstream\b|fstream\b|fin\s*>>|\bin\s*>>|\bsystem\.in\b|\b[a-z_]\w*\s*>>\s*&?\s*[a-z_]\w*)/i.test(
    sourceCode,
  );
}

function collectInputVariables(sourceCode: string): Set<string> {
  const inputVariables = new Set<string>();
  const normalized = sourceCode.toLowerCase();
  const patterns = [
    /\b(?:cin|fin|in|[a-z_]\w*)\s*>>\s*&?\s*([a-z_]\w*)/g,
    /\b(?:scanf|fscanf)\s*\([^)]*&\s*([a-z_]\w*)/g,
    /\b([a-z_]\w*)\s*=\s*[^;\n]*\binput\s*\(/g,
    /\b(?:std::)?getline\s*\([^,]+,\s*([a-z_]\w*)/g,
  ];

  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const variable = match[1]?.trim();
      if (variable) {
        inputVariables.add(variable);
      }
    }
  }

  return inputVariables;
}

function collectExactInputLiteralComparisons(
  normalizedSourceCode: string,
  inputVariables: Set<string>,
): Array<{ variable: string; literal: string }> {
  if (inputVariables.size === 0) {
    return [];
  }

  const comparisons: Array<{ variable: string; literal: string }> = [];
  const identifierFirst =
    /\b([a-z_]\w*)\b\s*(==|!=)\s*((?:"[^"\n]{0,32}"|'[^'\n]{0,4}'|-?\d{1,9}))/g;
  const literalFirst = /((?:"[^"\n]{0,32}"|'[^'\n]{0,4}'|-?\d{1,9}))\s*(==|!=)\s*\b([a-z_]\w*)\b/g;

  for (const match of normalizedSourceCode.matchAll(identifierFirst)) {
    const variable = match[1];
    const literal = match[3];
    if (!variable || !literal) {
      continue;
    }
    if (!inputVariables.has(variable)) {
      continue;
    }
    comparisons.push({ variable, literal: literal.trim() });
  }

  for (const match of normalizedSourceCode.matchAll(literalFirst)) {
    const variable = match[3];
    const literal = match[1];
    if (!variable || !literal) {
      continue;
    }
    if (!inputVariables.has(variable)) {
      continue;
    }
    comparisons.push({ variable, literal: literal.trim() });
  }

  return comparisons;
}

function countSuspiciousSwitchCases(
  normalizedSourceCode: string,
  inputVariables: Set<string>,
): number {
  if (inputVariables.size === 0) {
    return 0;
  }

  const switchesOnInputVariables = [...inputVariables].some((variable) =>
    new RegExp(`\\bswitch\\s*\\(\\s*${variable}\\s*\\)`).test(normalizedSourceCode),
  );
  if (!switchesOnInputVariables) {
    return 0;
  }

  return (
    normalizedSourceCode.match(/\bcase\s+(?:"[^"\n]{0,32}"|'[^'\n]{0,4}'|-?\d{1,9})\s*:/g) ?? []
  ).length;
}

function isTrivialSentinelLiteral(literal: string): boolean {
  return ['0', '1', '-1'].includes(literal.trim());
}

function summarizeComparisonsByVariable(
  comparisons: Array<{ variable: string; literal: string }>,
): Map<string, number> {
  const summary = new Map<string, number>();
  for (const comparison of comparisons) {
    if (isTrivialSentinelLiteral(comparison.literal)) {
      continue;
    }

    summary.set(comparison.variable, (summary.get(comparison.variable) ?? 0) + 1);
  }
  return summary;
}

function isSubstantiveOutputLiteral(literal: string | undefined): boolean {
  if (!literal) {
    return false;
  }

  const normalizedLiteral = literal
    .replace(/\\[nrt0]/g, '')
    .replace(/\s+/g, '')
    .trim();
  if (normalizedLiteral.length === 0) {
    return false;
  }

  return true;
}
