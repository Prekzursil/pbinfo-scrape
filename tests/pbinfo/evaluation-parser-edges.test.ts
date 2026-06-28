import { describe, expect, test } from 'vitest';

import { parseEvaluationPage } from '../../src/pbinfo/parsers/evaluation.js';

function buildEval(summaryRows: string, extra = ''): string {
  return `
    <div id="rezumat">
      <a href="/probleme/10/demo">Demo</a>
      <table class="table">${summaryRows}</table>
    </div>
    ${extra}
  `;
}

describe('evaluation parser edge cases', () => {
  test('throws when no problem link is present', () => {
    expect(() => parseEvaluationPage('<div>nothing</div>', 1)).toThrow(
      'Could not find problem link for evaluation 1',
    );
  });

  test('falls back to "unknown" user when no summary owner or profile link exists', () => {
    const parsed = parseEvaluationPage(buildEval('<tr><th>Punctaj</th><td>50</td></tr>'), 2);
    expect(parsed.user).toBe('unknown');
    expect(parsed.score).toBe(50);
  });

  test('skips summary rows with fewer than two cells', () => {
    const parsed = parseEvaluationPage(
      buildEval('<tr><th>Solo</th></tr><tr><th>Punctaj</th><td>30</td></tr>'),
      3,
    );
    expect(parsed.score).toBe(30);
  });

  test('skips result rows whose index cell is not numeric', () => {
    const extra = `
      <div id="detalii">
        <table class="table table-bordered">
          <tr><th>Test</th><th>Scor</th></tr>
          <tr><td>not-a-number</td><td>5</td></tr>
          <tr><td>1</td><td>5</td></tr>
        </table>
      </div>`;
    const parsed = parseEvaluationPage(buildEval('<tr><th>Punctaj</th><td>5</td></tr>', extra), 4);
    expect(parsed.tests).toHaveLength(1);
    expect(parsed.tests[0]?.index).toBe(1);
  });

  test('reads source code from a code_* pre block when no textarea or #sursa exists', () => {
    const extra = '<pre class="code_cpp">int main(){return 0;}</pre>';
    const parsed = parseEvaluationPage(buildEval('<tr><th>Punctaj</th><td>5</td></tr>', extra), 5);
    expect(parsed.sourceAvailable).toBe(true);
    expect(parsed.sourceCode).toContain('int main');
  });

  test.each([
    ['solution.pas', 'pas'],
    ['solution.cs', 'cs'],
    ['solution.php', 'php'],
    ['solution.py', 'py'],
    ['solution.py3', 'py3'],
    ['solution.java', 'java'],
  ])('infers language %s from the file name when limbaj is absent', (fileName, expected) => {
    const parsed = parseEvaluationPage(
      buildEval(`<tr><th>Fisier</th><td>${fileName}</td></tr>`),
      6,
    );
    expect(parsed.language).toBe(expected);
  });

  test('defaults language to "unknown" for an unrecognized file extension', () => {
    const parsed = parseEvaluationPage(
      buildEval('<tr><th>Fisier</th><td>solution.rb</td></tr>'),
      7,
    );
    expect(parsed.language).toBe('unknown');
  });

  test('coerces unparsable per-test score and max-score cells to zero', () => {
    const extra = `
      <div id="detalii">
        <table class="table table-bordered">
          <tr><th>Test</th><th>Scor obtinut</th><th>Scor posibil</th></tr>
          <tr><td>1</td><td>n/a</td><td>n/a</td></tr>
        </table>
      </div>`;
    const parsed = parseEvaluationPage(buildEval('<tr><th>Punctaj</th><td>5</td></tr>', extra), 8);
    expect(parsed.tests[0]?.score).toBe(0);
    expect(parsed.tests[0]?.maxScore).toBe(0);
  });

  test('defaults per-test score and max-score to zero when those columns are absent', () => {
    const extra = `
      <div id="detalii">
        <table class="table table-bordered">
          <tr><th>Test</th></tr>
          <tr><td>1</td></tr>
        </table>
      </div>`;
    const parsed = parseEvaluationPage(buildEval('<tr><th>Punctaj</th><td>5</td></tr>', extra), 9);
    expect(parsed.tests[0]?.score).toBe(0);
    expect(parsed.tests[0]?.maxScore).toBe(0);
  });

  test('treats a blank textarea as no source code', () => {
    const parsed = parseEvaluationPage(buildEval('<tr><th>Punctaj</th><td>5</td></tr>', '<textarea>   </textarea>'), 10);
    expect(parsed.sourceAvailable).toBe(false);
    expect(parsed.sourceCode).toBeUndefined();
  });

  test('treats a blank #sursa pre block as no source code', () => {
    const parsed = parseEvaluationPage(
      buildEval('<tr><th>Punctaj</th><td>5</td></tr>', '<div id="sursa"><pre>   </pre></div>'),
      11,
    );
    expect(parsed.sourceCode).toBeUndefined();
  });

  test('treats a blank code_* pre block as no source code', () => {
    const parsed = parseEvaluationPage(
      buildEval('<tr><th>Punctaj</th><td>5</td></tr>', '<pre class="code_cpp">   </pre>'),
      12,
    );
    expect(parsed.sourceCode).toBeUndefined();
  });

  test('treats a blank compilation log as no compile log', () => {
    const parsed = parseEvaluationPage(
      buildEval('<tr><th>Punctaj</th><td>5</td></tr>', '<div id="compilare"><pre>   </pre></div>'),
      13,
    );
    expect(parsed.compileLog).toBeUndefined();
  });
});
