import { describe, expect, test } from 'vitest';

import {
  parseOfficialSolutionFragment,
  parseProblemEndpointFragment,
  parseProblemPage,
  parseProblemStatementFragment,
} from '../../src/pbinfo/parsers/problem.js';

describe('parseOfficialSolutionFragment further branches', () => {
  test('ignores buttons whose data-bs-target does not start with #', () => {
    const html = `
      <html><body>
        <button data-bs-target=".not-anchor">External</button>
        <div id="solCpp"><h4>C++</h4><pre>int main(){}</pre></div>
      </body></html>
    `;
    const parsed = parseOfficialSolutionFragment(html);
    expect(parsed.access).toBe('visible');
    expect(Object.keys(parsed.solutions)).toContain('C++');
  });

  test('skips solution containers that have no id and no pre/textarea content', () => {
    const html = `
      <html><body>
        <div id="empty"></div>
      </body></html>
    `;
    const parsed = parseOfficialSolutionFragment(html);
    expect(parsed.solutions).toEqual({});
  });

  test('uses heading label fallback when tabLabels mapping is missing', () => {
    const html = `
      <html><body>
        <div id="solDefault">
          <h4>Java</h4>
          <pre>class Main {}</pre>
        </div>
      </body></html>
    `;
    const parsed = parseOfficialSolutionFragment(html);
    expect(parsed.solutions).toEqual(
      expect.objectContaining({
        Java: expect.stringContaining('class Main'),
      }),
    );
  });

  test('falls back to first pre when no labelled solution containers exist', () => {
    const html = `<html><body><pre>fallback-code</pre></body></html>`;
    const parsed = parseOfficialSolutionFragment(html);
    expect(parsed.solutions).toEqual({ unknown: 'fallback-code' });
  });
});

describe('parseProblemStatementFragment further branches', () => {
  test('skips empty paragraphs that are not pre blocks while parsing examples', () => {
    const html = `
      <article id="enunt">
        <h1>Exemple</h1>
        <p>Exemplu</p>
        <p>Intrare</p>
        <pre>1 2 3</pre>
        <p>Iesire</p>
        <pre>6</pre>
        <p>   </p>
        <p>Explicație</p>
        <p>suma</p>
      </article>
    `;
    const result = parseProblemStatementFragment(html);
    expect(result.examples.length).toBeGreaterThan(0);
  });

  test('parses GB memory hint multiplier and time limit hint together', () => {
    const html = `
      <article id="enunt">
        <h1>Restricții</h1>
        <ul>
          <li>Timp maxim de executare: 2 secunde</li>
          <li>Memorie maximă: 1 GB</li>
        </ul>
      </article>
    `;
    const result = parseProblemStatementFragment(html);
    expect(result.executionHints.timeLimitSeconds).toBe(2);
    expect(result.executionHints.memoryLimitMb).toBe(1024);
  });

  test('returns plain numeric value when constraint has no kb/gb unit', () => {
    const html = `
      <article id="enunt">
        <h1>Restricții</h1>
        <ul>
          <li>Memorie maximă: 64 mb</li>
        </ul>
      </article>
    `;
    const result = parseProblemStatementFragment(html);
    // memory in MB stays as-is
    expect(result.executionHints.memoryLimitMb).toBe(64);
  });
});

describe('parseProblemEndpointFragment visible-test branches', () => {
  test('skips heading-based tests when no h3 starts with Test', () => {
    const html = `
      <html><body>
        <h3>Solutie</h3>
        <p>Intrare</p>
        <pre>1</pre>
      </body></html>
    `;
    const parsed = parseProblemEndpointFragment(html);
    expect(parsed.access).toBe('visible');
    if (parsed.access === 'visible') {
      expect(parsed.visibleTests).toEqual([]);
    }
  });

  test('stops collection of heading test body on the next h3 sibling', () => {
    const html = `
      <html><body>
        <h3>Testul 1</h3>
        <p>Intrare</p>
        <pre>3</pre>
        <p>Iesire</p>
        <pre>6</pre>
        <h3>Testul 2</h3>
        <p>Intrare</p>
        <pre>5</pre>
        <p>Iesire</p>
        <pre>10</pre>
      </body></html>
    `;
    const parsed = parseProblemEndpointFragment(html);
    if (parsed.access === 'visible') {
      expect(parsed.visibleTests.length).toBe(2);
    } else {
      expect.fail('expected visible access');
    }
  });

  test('table tests ignore rows missing both input and output', () => {
    const html = `
      <html><body>
        <table><tbody>
          <tr>
            <td>1</td>
            <td>50</td>
            <td><textarea></textarea></td>
            <td><textarea></textarea></td>
            <td>Da</td>
          </tr>
          <tr>
            <td>2</td>
            <td>50</td>
            <td><textarea>x</textarea></td>
            <td><textarea>y</textarea></td>
            <td>Nu</td>
          </tr>
        </tbody></table>
      </body></html>
    `;
    const parsed = parseProblemEndpointFragment(html);
    if (parsed.access === 'visible') {
      expect(parsed.visibleTests).toEqual([
        expect.objectContaining({
          title: 'Testul 2',
          exampleLike: false,
          input: 'x',
          output: 'y',
        }),
      ]);
    }
  });
});

describe('parseProblemPage further category and asset branches', () => {
  test('skips anchors with empty href when collecting categories or assets', () => {
    const html = `
      <html><body>
        <h1><a href="/probleme/77/swap">Swap</a></h1>
        <table>
          <tr><th>Autor</th></tr>
          <tr><td>cineva</td></tr>
        </table>
        <a href="?pagina=probleme-lista&clasa=10" class="categorie"></a>
        <link rel="stylesheet" href="">
        <script src=""></script>
        <img src="">
      </body></html>
    `;
    const result = parseProblemPage(html, 'https://www.pbinfo.ro/probleme/77/swap');
    expect(result.linkedAssets).toEqual([]);
  });

  test('handles posted-by handle via summary text paren fallback', () => {
    const html = `
      <html><body>
        <h1><a href="/probleme/88/sample">Sample</a></h1>
        <table>
          <tr><th>Postată de</th></tr>
          <tr><td>Nume Profesor (myprofhandle)</td></tr>
        </table>
      </body></html>
    `;
    const result = parseProblemPage(html, 'https://www.pbinfo.ro/probleme/88/sample');
    expect(result.metadata).toEqual(
      expect.objectContaining({
        authorHandle: 'myprofhandle',
      }),
    );
  });
});
