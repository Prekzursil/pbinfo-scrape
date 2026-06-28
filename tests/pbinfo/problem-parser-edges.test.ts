import { describe, expect, test } from 'vitest';

import {
  parseOfficialSolutionFragment,
  parseProblemEndpointFragment,
  parseProblemPage,
  parseProblemStatementFragment,
} from '../../src/pbinfo/parsers/problem.js';

describe('parseProblemPage edge branches', () => {
  test('throws when problem identity cannot be inferred', () => {
    expect(() => parseProblemPage('<html><body></body></html>', 'https://www.pbinfo.ro/x')).toThrow(
      /Could not infer problem identity/,
    );
  });

  test('parses identity from the title link, summary table, assets and statement hints', () => {
    const html = `<html><body>
      <h1><a href="/probleme/123/sum">Sum</a></h1>
      <table>
        <tr><th>Clasa</th><th>Limită timp</th><th>Limită memorie</th><th>Autor</th><th>Sursa problemei</th><th>Extra</th></tr>
        <tr><td>9</td><td>2 secunde</td><td>64 / 1</td><td>Ion</td><td>OJI</td></tr>
      </table>
      <div id="rezumat"><table>
        <tr><th>Postată de</th><td><a href="/profil/teacher">teacher</a></td></tr>
        <tr><th>Altceva</th><td>x</td></tr>
      </table></div>
      <a href="/solutii/problema/123/sum">solutii</a>
      <a href="?pagina=probleme-lista&clasa=9">Clasa 9</a>
      <a href="?pagina=probleme-lista&tag=5">Grafuri</a>
      <a href="?pagina=probleme-lista">No id</a>
      <a href="?pagina=probleme-lista&clasa=3"></a>
      <a href="/probleme/eticheta/grafuri">grafuri</a>
      <a href="/probleme/eticheta/grafuri">grafuri</a>
      <link rel="stylesheet" href="/style.css">
      <script src="/app.js"></script>
      <img src="/pic.png">
      <img src="https://cdn.example.com/ext.png">
      <div id="enunt">
        <h1>Restricții</h1>
        <ul>
          <li>Timp de executare: 2 secunde</li>
          <li>Memorie: 64 KB</li>
          <li>Memorie: 1 GB</li>
          <li>Memorie: 32 MB</li>
          <li>fara numar aici</li>
        </ul>
        <h1>Exemplu</h1>
        <p>Intrare</p><pre>1 2</pre>
        <p>Ieşire</p><pre>3</pre>
        <p>Explicaţie</p><p>adunare</p>
      </div>
    </body></html>`;

    // URL without the /probleme/<id>/<slug> pattern -> identity from the title link.
    const record = parseProblemPage(html, 'https://www.pbinfo.ro/probleme');
    expect(record.id).toBe(123);
    expect(record.slug).toBe('sum');
    expect(record.grade).toBe(9);
    expect(record.sourceListUrl).toBe('https://www.pbinfo.ro/solutii/problema/123/sum');
    expect(record.tags).toEqual(['grafuri']);
    expect(record.categoryChain.length).toBe(2);
    expect(record.linkedAssets.map((asset) => asset.kind).sort()).toEqual([
      'image',
      'script',
      'stylesheet',
    ]);
    expect(record.examples[0]?.explanation).toBe('adunare');
    expect(record.metadata.authorHandle).toBe('teacher');
    expect(record.timeLimitSeconds).toBeGreaterThan(0);
    expect(record.memoryLimitMb).toBeDefined();
  });

  test('uses the preferred author link and the class-link grade fallback', () => {
    const html = `<html><body>
      <h1><a href="/probleme/55/tree">Tree</a></h1>
      <table>
        <tr><th>Autor</th></tr>
        <tr><td>-</td></tr>
      </table>
      <span title="Postată de"><a href="/profil/preferred">Preferred</a></span>
      <a href="/probleme?clasa=11">11</a>
    </body></html>`;
    const record = parseProblemPage(html, 'https://www.pbinfo.ro/probleme/55/tree');
    expect(record.metadata.authorHandle).toBe('preferred');
    expect(record.grade).toBe(11);
    expect(record.author).toBeUndefined();
  });

  test('reads the author handle from summary parenthetical text', () => {
    const html = `<html><body>
      <h1><a href="/probleme/7/x">X</a></h1>
      <table>
        <tr><th>Postată de</th></tr>
        <tr><td>Real Name (handleguy)</td></tr>
      </table>
    </body></html>`;
    const record = parseProblemPage(html, 'https://www.pbinfo.ro/probleme/7/x');
    expect(record.metadata.authorHandle).toBe('handleguy');
  });

  test('falls back to the slug for the name and omits an absent author handle', () => {
    const record = parseProblemPage(
      '<html><body><h1><a href="/probleme/9/zeta"></a></h1></body></html>',
      'https://www.pbinfo.ro/probleme/9/zeta',
    );
    expect(record.name).toBe('zeta');
    expect(record.metadata.authorHandle).toBeUndefined();
  });

  test('falls back to a generic profile link for the author handle', () => {
    const html = `<html><body>
      <h1><a href="/probleme/8/y">Y</a></h1>
      <article><a href="/profil/genericuser">someone</a></article>
    </body></html>`;
    const record = parseProblemPage(html, 'https://www.pbinfo.ro/probleme/8/y');
    expect(record.metadata.authorHandle).toBe('genericuser');
  });
});

describe('parseProblemStatementFragment execution hints', () => {
  function hints(li: string[]): ReturnType<typeof parseProblemStatementFragment>['executionHints'] {
    const items = li.map((value) => `<li>${value}</li>`).join('');
    return parseProblemStatementFragment(
      `<div id="enunt"><h1>Restricţii</h1><ul>${items}</ul></div>`,
    ).executionHints;
  }

  test('keeps the first time limit and ignores constraints without numbers', () => {
    expect(hints(['Timp de executare: 2 secunde', 'Timp: 3 secunde', 'fara numar']).timeLimitSeconds).toBe(2);
  });

  test('converts KB memory limits and keeps the first value', () => {
    expect(hints(['Memorie: 1024 KB', 'Memorie: 2048 KB']).memoryLimitMb).toBe(1);
  });

  test('converts GB memory limits and keeps the first value', () => {
    expect(hints(['Memorie: 1 GB', 'Memorie: 2 GB']).memoryLimitMb).toBe(1024);
  });

  test('treats bare memory limits as MB and keeps the first value', () => {
    expect(hints(['Memorie: 32 MB', 'Memorie: 64 MB']).memoryLimitMb).toBe(32);
  });

  test('skips empty example nodes', () => {
    const result = parseProblemStatementFragment(
      `<div id="enunt"><h1>Exemplu</h1><p>Intrare</p><pre>1</pre><span></span><p>Ieşire</p><pre>2</pre></div>`,
    );
    expect(result.examples).toEqual([{ input: '1', output: '2' }]);
  });
});

describe('parseProblemEndpointFragment access states', () => {
  test('reports hidden access', () => {
    const result = parseProblemEndpointFragment(
      '<div class="alert alert-danger">Testele nu sunt vizibile.</div>',
    );
    expect(result.access).toBe('hidden');
  });

  test('reports restricted access', () => {
    const result = parseProblemEndpointFragment(
      '<div class="alert alert-danger">Nu ai voie să vezi asta.</div>',
    );
    expect(result.access).toBe('restricted');
  });

  test('parses visible tests from an h3 layout', () => {
    const html = `<div>
      <h3>Other heading</h3>
      <h3>Testul 1</h3>
      <p>Intrare</p><pre>1</pre>
      <p>Ieşire</p><pre>2</pre>
      <h3>Testul 2</h3>
      <p>Intrare</p><pre>3</pre>
      <p>Ieşire</p><pre>4</pre>
    </div>`;
    const result = parseProblemEndpointFragment(html);
    expect(result.access).toBe('visible');
    expect(result.visibleTests).toHaveLength(2);
    expect(result.visibleTests[0]?.input).toBe('1');
  });

  test('parses visible tests from a table layout and skips malformed rows', () => {
    const html = `<table><tbody>
      <tr><td>1</td><td>10</td><td><textarea>in</textarea></td><td><textarea>out</textarea></td><td>Da</td></tr>
      <tr><td>2</td><td></td><td><textarea>i2</textarea></td><td><textarea>o2</textarea></td><td>Nu</td></tr>
      <tr><td>3</td><td>5</td><td></td><td></td><td>Da</td></tr>
      <tr><td>short</td></tr>
    </tbody></table>`;
    const result = parseProblemEndpointFragment(html);
    expect(result.visibleTests).toHaveLength(2);
    expect(result.visibleTests[0]?.score).toBe(10);
    expect(result.visibleTests[0]?.exampleLike).toBe(true);
    expect(result.visibleTests[1]?.score).toBeUndefined();
    expect(result.visibleTests[1]?.exampleLike).toBe(false);
  });
});

describe('parseOfficialSolutionFragment', () => {
  test('returns early when access is not visible', () => {
    const result = parseOfficialSolutionFragment(
      '<div class="alert alert-danger">Testele nu sunt vizibile.</div>',
    );
    expect(result.access).toBe('hidden');
    expect(result.solutions).toEqual({});
  });

  test('extracts labeled solutions from tab targets', () => {
    const html = `<div>
      <a href="#cpp-tab">C++</a>
      <button data-bs-target="not-a-hash">ignored</button>
      <div id="cpp-tab"><pre>int main(){}</pre></div>
      <div id="py-tab"><h4>Python</h4><textarea>print(1)</textarea></div>
      <div id="empty-tab"></div>
      <div id="nolabel-tab"><pre>orphan code</pre></div>
    </div>`;
    const result = parseOfficialSolutionFragment(html);
    expect(result.access).toBe('visible');
    expect(result.solutions['C++']).toContain('int main');
    expect(result.solutions.Python).toContain('print(1)');
    expect(result.solutions.unknown).toBe('orphan code');
  });

  test('falls back to the first code block when no labeled solutions exist', () => {
    const html = '<div><pre>just code</pre></div>';
    const result = parseOfficialSolutionFragment(html);
    expect(result.solutions.unknown).toBe('just code');
  });
});
