import { describe, expect, test } from 'vitest';

import { parseEvaluationPage } from '../../src/pbinfo/parsers/evaluation.js';

describe('parseEvaluationPage edge fallbacks', () => {
  test('falls back to unknown user when no profile or summary user is present', () => {
    const html = `
      <html><body>
        <h1><a href="/probleme/12/sample">Sample</a></h1>
      </body></html>
    `;
    const result = parseEvaluationPage(html, 9001);
    expect(result.user).toBe('unknown');
  });

  test('falls back to profile-link text when summary user is absent', () => {
    const html = `
      <html><body>
        <h1><a href="/probleme/12/sample">Sample</a></h1>
        <a href="/profil/alice">Alice</a>
      </body></html>
    `;
    const result = parseEvaluationPage(html, 9002);
    expect(result.user).toBe('Alice');
  });

  test('skips evaluation table rows that do not have two cells', () => {
    const html = `
      <html><body>
        <h1><a href="/probleme/12/sample">Sample</a></h1>
        <div id="rezumat">
          <table>
            <tr><th>only-header</th></tr>
            <tr><th>Utilizator</th><td>charlie</td></tr>
          </table>
        </div>
      </body></html>
    `;
    const result = parseEvaluationPage(html, 9003);
    expect(result.user).toBe('charlie');
  });

  test('skips test rows whose first cell has no parseable index', () => {
    const html = `
      <html><body>
        <h1><a href="/probleme/12/sample">Sample</a></h1>
        <div id="evaluare">
          <table>
            <tr><th>Test</th><th>Verdict</th></tr>
            <tr><td>n/a</td><td>OK</td></tr>
            <tr><td>2</td><td>OK</td></tr>
          </table>
        </div>
      </body></html>
    `;
    const result = parseEvaluationPage(html, 9004);
    expect(result.tests).toEqual([
      expect.objectContaining({
        index: 2,
      }),
    ]);
  });

  test('falls back to data-source pre when textarea and #sursa are missing', () => {
    const html = `
      <html><body>
        <h1><a href="/probleme/12/sample">Sample</a></h1>
        <pre data-source>int main() { return 0; }</pre>
      </body></html>
    `;
    const result = parseEvaluationPage(html, 9005);
    expect(result.sourceCode).toContain('int main');
  });

  test('returns undefined source when no textarea/#sursa/data-source pre exists', () => {
    const html = `
      <html><body>
        <h1><a href="/probleme/12/sample">Sample</a></h1>
      </body></html>
    `;
    const result = parseEvaluationPage(html, 9006);
    expect(result.sourceCode).toBeUndefined();
  });

  test('reads compile log from .compile-log pre fallback selector', () => {
    const html = `
      <html><body>
        <h1><a href="/probleme/12/sample">Sample</a></h1>
        <div class="compile-log">
          <pre>error: stray semicolon</pre>
        </div>
      </body></html>
    `;
    const result = parseEvaluationPage(html, 9007);
    expect(result.compileLog).toContain('stray semicolon');
  });

  test('returns empty test list when there is no qualifying table', () => {
    const html = `
      <html><body>
        <h1><a href="/probleme/12/sample">Sample</a></h1>
      </body></html>
    `;
    const result = parseEvaluationPage(html, 9008);
    expect(result.tests).toEqual([]);
  });

  test('throws when problem link is missing', () => {
    const html = `<html><body><p>no link here</p></body></html>`;
    expect(() => parseEvaluationPage(html, 9009)).toThrow(/Could not find problem link/);
  });
});
