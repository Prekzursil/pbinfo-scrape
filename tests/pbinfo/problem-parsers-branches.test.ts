import { describe, expect, test } from 'vitest';

import {
  parseOfficialSolutionFragment,
  parseProblemEndpointFragment,
  parseProblemPage,
  parseProblemStatementFragment,
} from '../../src/pbinfo/parsers/problem.js';

describe('parseProblemPage edge cases', () => {
  test('throws when pathname and title link lack a usable identity', () => {
    const html = `
      <html><body>
        <h1>No anchor heading</h1>
      </body></html>
    `;
    expect(() => parseProblemPage(html, 'https://www.pbinfo.ro/probleme/')).toThrow(
      /Could not infer problem identity/,
    );
  });

  test('falls back to the title-link href when the URL lacks an identity path', () => {
    const html = `
      <html><body>
        <h1><a href="/probleme/123/slugged">Slugged</a></h1>
        <table>
          <tr><th>Autor</th></tr>
          <tr><td>cineva</td></tr>
        </table>
      </body></html>
    `;
    const result = parseProblemPage(html, 'https://www.pbinfo.ro/some-path');
    expect(result.id).toBe(123);
    expect(result.slug).toBe('slugged');
  });
});

describe('parseProblemStatementFragment branches', () => {
  test('falls back to the article root when #enunt is missing', () => {
    const html = `
      <article>
        <h1>Cerința</h1>
        <p>Detalii</p>
      </article>
    `;
    const result = parseProblemStatementFragment(html);
    expect(result.sections.length).toBeGreaterThan(0);
  });

  test('parses memory limit in kb correctly', () => {
    const html = `
      <article id="enunt">
        <h1>Restricții</h1>
        <ul>
          <li>Memorie maximă: 4096 kb</li>
        </ul>
      </article>
    `;
    const result = parseProblemStatementFragment(html);
    expect(result.executionHints.memoryLimitMb).toBeCloseTo(4);
  });

  test('parses memory limit in gb correctly', () => {
    const html = `
      <article id="enunt">
        <h1>Restricții</h1>
        <ul>
          <li>Memorie: 2 gb</li>
        </ul>
      </article>
    `;
    const result = parseProblemStatementFragment(html);
    expect(result.executionHints.memoryLimitMb).toBe(2048);
  });

  test('ignores constraints without numeric tokens', () => {
    const html = `
      <article id="enunt">
        <h1>Restricții</h1>
        <ul>
          <li>nicio cifră</li>
        </ul>
      </article>
    `;
    const result = parseProblemStatementFragment(html);
    expect(result.executionHints.timeLimitSeconds).toBeUndefined();
  });
});

describe('parseProblemEndpointFragment branches', () => {
  test('reports restricted access when the alert says n-ai voie', () => {
    const html = `<div class="alert alert-danger">N-ai voie aici!</div>`;
    expect(parseProblemEndpointFragment(html).access).toBe('restricted');
  });

  test('reports hidden access for the visible-tests warning', () => {
    const html = `<div class="alert alert-danger">testele nu sunt vizibile pentru tine.</div>`;
    expect(parseProblemEndpointFragment(html).access).toBe('hidden');
  });

  test('extracts visible tests from h3 headings when no table is present', () => {
    const html = `
      <h3>Testul 1</h3>
      <p>Intrare</p>
      <pre>3 4</pre>
      <p>Ieșire</p>
      <pre>7</pre>
      <h3>Other heading</h3>
    `;
    const result = parseProblemEndpointFragment(html);
    expect(result.visibleTests).toEqual([
      expect.objectContaining({ title: 'Testul 1', input: '3 4', output: '7' }),
    ]);
  });

  test('extracts visible tests from a table with example-like flag', () => {
    const html = `
      <table>
        <tbody>
          <tr>
            <td>1</td>
            <td>10</td>
            <td><textarea>3</textarea></td>
            <td><textarea>9</textarea></td>
            <td>da</td>
          </tr>
        </tbody>
      </table>
    `;
    const result = parseProblemEndpointFragment(html);
    expect(result.visibleTests).toEqual([
      expect.objectContaining({ title: 'Testul 1', exampleLike: true, score: 10 }),
    ]);
  });

  test('skips table rows without enough cells', () => {
    const html = `
      <table>
        <tbody>
          <tr><td>1</td><td>10</td></tr>
        </tbody>
      </table>
    `;
    const result = parseProblemEndpointFragment(html);
    expect(result.visibleTests).toEqual([]);
  });

  test('skips table rows that have no input nor output', () => {
    const html = `
      <table>
        <tbody>
          <tr>
            <td>1</td><td>0</td>
            <td><textarea>  </textarea></td>
            <td><textarea>  </textarea></td>
            <td>nu</td>
          </tr>
        </tbody>
      </table>
    `;
    const result = parseProblemEndpointFragment(html);
    expect(result.visibleTests).toEqual([]);
  });
});

describe('parseOfficialSolutionFragment branches', () => {
  test('returns empty result with restricted access without parsing', () => {
    const html = `<div class="alert alert-danger">n-ai voie</div>`;
    const result = parseOfficialSolutionFragment(html);
    expect(result.access).toBe('restricted');
    expect(result.solutions).toEqual({});
  });

  test('falls back to a single pre when no id-tagged sections exist', () => {
    const html = `<pre>int main(){}</pre>`;
    const result = parseOfficialSolutionFragment(html);
    expect(result.solutions).toEqual({ unknown: 'int main(){}' });
  });

  test('skips tab-target anchors that do not point to a fragment', () => {
    const html = `
      <a href="https://external.example/">External</a>
      <div id="cpp"><pre>int x;</pre></div>
    `;
    const result = parseOfficialSolutionFragment(html);
    // 'cpp' id captured with default unknown label (no tab label matched)
    expect(Object.values(result.solutions)).toContain('int x;');
  });

  test('skips elements with id but no code in <pre> or <textarea>', () => {
    const html = `
      <a href="#cpp">C++</a>
      <div id="cpp"></div>
    `;
    const result = parseOfficialSolutionFragment(html);
    expect(result.solutions).toEqual({});
  });
});

describe('extra branch coverage for resolveSourceListUrl and category chain', () => {
  test('resolves source list URL when an anchor is present', () => {
    const html = `
      <h1><a href="/probleme/9/sigma">sigma</a></h1>
      <a href="/solutii/problema/9/sigma">Source list</a>
    `;
    const result = parseProblemPage(html, 'https://www.pbinfo.ro/probleme/9/sigma');
    expect(result.sourceListUrl).toBe('https://www.pbinfo.ro/solutii/problema/9/sigma');
  });

  test('extracts a non-cross-origin linked asset and skips cross-origin', () => {
    const html = `
      <h1><a href="/probleme/9/sigma">sigma</a></h1>
      <link rel="stylesheet" href="/static/site.css" />
      <script src="/static/site.js"></script>
      <img src="/static/photo.png" />
      <img src="https://other.example/photo.png" />
    `;
    const result = parseProblemPage(html, 'https://www.pbinfo.ro/probleme/9/sigma');
    const urls = result.linkedAssets.map((asset) => asset.url);
    expect(urls).toContain('https://www.pbinfo.ro/static/site.css');
    expect(urls).not.toContain('https://other.example/photo.png');
  });

  test('extracts category chain, skipping anchors with no href, no name, or no id', () => {
    const html = `
      <h1><a href="/probleme/9/sigma">sigma</a></h1>
      <a href="?pagina=probleme-lista&clasa=9">Clasa a IX-a</a>
      <a href="?pagina=probleme-lista">no id</a>
      <a href="?pagina=probleme-lista&tag=12"></a>
      <a>?pagina=probleme-lista&clasa=10</a>
    `;
    const result = parseProblemPage(html, 'https://www.pbinfo.ro/probleme/9/sigma');
    const ids = result.categoryChain.map((c) => c.id);
    expect(ids).toContain(9);
    expect(ids).not.toContain(12);
  });

  test('extracts a memory limit through the summary table primary row', () => {
    const html = `
      <h1><a href="/probleme/9/sigma">sigma</a></h1>
      <table>
        <tr>
          <th>Limită memorie</th>
          <th>Limită timp</th>
          <th>Clasa</th>
        </tr>
        <tr>
          <td>64 MB</td>
          <td>1 s</td>
          <td>9</td>
        </tr>
      </table>
    `;
    const result = parseProblemPage(html, 'https://www.pbinfo.ro/probleme/9/sigma');
    expect(result.memoryLimitMb).toBe(64);
    expect(result.grade).toBe(9);
  });

  test('reads summary handle from #rezumat structured rows', () => {
    const html = `
      <h1><a href="/probleme/9/sigma">sigma</a></h1>
      <div id="rezumat">
        <table>
          <tr>
            <th>Postată de</th>
            <td><a href="/profil/dan">Dan</a></td>
          </tr>
        </table>
      </div>
    `;
    const result = parseProblemPage(html, 'https://www.pbinfo.ro/probleme/9/sigma');
    expect(result.metadata.authorHandle).toBe('dan');
  });

  test('extracts handle from parenthesized "Postată de" summary value', () => {
    const html = `
      <h1><a href="/probleme/9/sigma">sigma</a></h1>
      <table>
        <tr><th>Postată de</th></tr>
        <tr><td>Display Name (handle9)</td></tr>
      </table>
    `;
    const result = parseProblemPage(html, 'https://www.pbinfo.ro/probleme/9/sigma');
    expect(result.metadata.authorHandle).toBe('handle9');
  });

  test('falls back to a generic profile anchor when no postata-de markers exist', () => {
    const html = `
      <h1><a href="/probleme/9/sigma">sigma</a></h1>
      <article>
        <a href="/profil/random">Random</a>
      </article>
    `;
    const result = parseProblemPage(html, 'https://www.pbinfo.ro/probleme/9/sigma');
    expect(result.metadata.authorHandle).toBe('random');
  });

  test('extracts deduplicated tags', () => {
    const html = `
      <h1><a href="/probleme/9/sigma">sigma</a></h1>
      <a href="/probleme/eticheta/dp">DP</a>
      <a href="/probleme/eticheta/dp">DP</a>
      <a href="/probleme/eticheta/greedy">Greedy</a>
    `;
    const result = parseProblemPage(html, 'https://www.pbinfo.ro/probleme/9/sigma');
    expect(result.tags).toEqual(['DP', 'Greedy']);
  });
});
