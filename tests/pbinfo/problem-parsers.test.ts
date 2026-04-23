import { describe, expect, test } from 'vitest';

import {
  parseOfficialSolutionFragment,
  parseProblemEndpointFragment,
  parseProblemPage,
  parseProblemStatementFragment,
} from '../../src/pbinfo/parsers/problem.js';
import { parseCategoryPage } from '../../src/pbinfo/parsers/category.js';
import { parseUserSolutionsListPage } from '../../src/pbinfo/parsers/user-solutions.js';

const statementFragment = `
<article id="enunt">
  <h1>Cerința</h1>
  <p>Se dă un număr natural <code>n</code>.</p>
  <h1>Date de intrare</h1>
  <p>Programul citește numărul <code>n</code>.</p>
  <h1>Date de ieșire</h1>
  <p>Programul afișează suma cerută.</p>
  <h1>Restricții și precizări</h1>
  <ul>
    <li><code>10 ≤ n ≤ 1.000.000.000</code></li>
    <li>Timp de executare: <code>0.2s</code></li>
  </ul>
  <h1>Exemplu:</h1>
  <p><strong>Intrare</strong></p>
  <pre>57289</pre>
  <p><strong>Ieșire</strong></p>
  <pre>11</pre>
  <h3>Explicație</h3>
  <p>Rezultatul corect este <code>11</code>.</p>
</article>
`;

const restrictedSolutionFragment = `
<h2>Indicații de rezolvare</h2>
<div class="alert alert-danger">
  N-ai voie să vezi indicațiile!
</div>
`;

const hiddenTestsFragment = `
<h2>Teste de evaluare</h2>
<div class="alert alert-danger">
  Pentru această problemă testele nu sunt vizibile!
</div>
`;

const visibleTestsFragment = `
<h2>Teste de evaluare</h2>
<div class="pb-tests">
  <h3>Testul 1</h3>
  <p><strong>Intrare</strong></p>
  <pre>3 4</pre>
  <p><strong>Ieșire</strong></p>
  <pre>7</pre>
</div>
`;

const legacyDiacriticsStatementFragment = `
<article id="enunt">
  <h1>Exemplu:</h1>
  <p><code>Intrare</code></p>
  <pre>2705</pre>
  <p><code>Ieşire</code></p>
  <pre>14</pre>
  <h3>Explicaţie</h3>
  <p>Suma cifrelor este 14.</p>
</article>
`;

const legacyDiacriticsVisibleTestsFragment = `
<h2>Teste de evaluare</h2>
<div class="pb-tests">
  <h3>Testul 2</h3>
  <p><strong>Intrare</strong></p>
  <pre>8 9</pre>
  <p><strong>Ieşire</strong></p>
  <pre>17</pre>
</div>
`;

const tabularVisibleTestsFragment = `
<h2>Teste de evaluare</h2>
<table class="table table-striped">
  <thead>
    <tr>
      <th>Nr. test</th>
      <th>Scor</th>
      <th>Intrare</th>
      <th>Ieșire</th>
      <th>Exemplu</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><tt>1</tt></td>
      <td><tt>20</tt></td>
      <td><textarea>30</textarea></td>
      <td><textarea>2 3 5 7</textarea></td>
      <td>da</td>
    </tr>
    <tr>
      <td><tt>2</tt></td>
      <td><tt>20</tt></td>
      <td><textarea>100</textarea></td>
      <td><textarea>2 3 5 7 11</textarea></td>
      <td>-</td>
    </tr>
  </tbody>
</table>
`;

const categoryPage = `
<div class="category-page">
  <a href="/probleme/categorii/2/tablouri-unidimensionale-vectori">Tablouri unidimensionale, vectori</a>
  <a href="/?pagina=itemi-evaluare-lista&disciplina=0&clasa=9&tag=2">Itemi</a>
  <a href="/probleme/categorii/9/tablouri-unidimensionale-vectori-parcurgerea-vectorilor">Parcurgerea vectorilor</a>
  <a href="/?pagina=itemi-evaluare-lista&disciplina=0&clasa=9&tag=2&subtag=9">Itemi</a>
  <a href="/probleme/categorii/44/tablouri-unidimensionale-vectori-probleme-diverse">Probleme diverse</a>
  <a href="/?pagina=itemi-evaluare-lista&disciplina=0&clasa=9&tag=2&subtag=44">Itemi</a>
</div>
`;

const userSolutionsPage = `
<h1>Soluții trimise</h1>
<div class="bold mb-3">13968 soluții respectă criteriile.</div>
<div class="alert alert-warning text-center my-5">
  Resursă indisponibilă temporar. Încercați din nou peste câteva secunde.
</div>
<a href="/profil/Zeli">Zeli</a>
<a href="/probleme/3253/par-impar3">par_impar3</a>
<a href="/detalii-evaluare/63568050">detalii</a>
<a href="/profil/DavidIanchis">DavidIanchis</a>
<a href="/probleme/3253/par-impar3">par_impar3</a>
<a href="/detalii-evaluare/63534271">detalii</a>
<script>
  $(document).ready(function(){
    let tmp = Paginare(13968, 0, 50);
  });
</script>
`;

const fullProblemPage = `
<html>
  <head>
    <link rel="stylesheet" href="/static/site.css">
    <script src="/static/problem.js"></script>
  </head>
  <body>
    <table>
      <tr>
        <th>Postată de</th>
        <th>Clasa</th>
        <th>Intrare/ieșire</th>
        <th>Limită timp</th>
        <th>Limită memorie</th>
        <th>Sursa problemei</th>
        <th>Autor</th>
        <th>Dificultate</th>
      </tr>
      <tr>
        <td><a href="/profil/Prekzursil">Andrei Visalon (Prekzursil)</a></td>
        <td>9</td>
        <td>tastatură / ecran</td>
        <td>0.2 secunde</td>
        <td>64 MB / 64 MB</td>
        <td>Admitere UNIBUC 2019</td>
        <td>Mirela Mlisan</td>
        <td>concurs</td>
      </tr>
    </table>
    <h1><span>#3171</span> <a href="/probleme/3171/waterreserve">WaterReserve</a></h1>
    <div>
      <ul>
        <li><a href="/?pagina=probleme-lista&clasa=9">Clasa a 9-a</a></li>
        <li><a href="/?pagina=probleme-lista&tag=2">Tablouri unidimensionale (vectori)</a></li>
        <li><a href="/?pagina=probleme-lista&tag=44">Probleme diverse</a></li>
      </ul>
      <div>Etichete: <a href="/probleme/eticheta/44/smenul-lui-mars-difference-arrays">Difference Arrays</a></div>
    </div>
    <article id="enunt">
      <h1>Cerința</h1>
      <p>Se cere să determinați cel mai mare număr de orașe.</p>
      <h1>Restricții și precizări</h1>
      <ul>
        <li><code>1 ≤ n ≤ 1.000.000</code></li>
      </ul>
      <h1>Exemplu:</h1>
      <p><strong>Intrare</strong></p>
      <pre>5 3 1 6 1 5</pre>
      <p><strong>Ieșire</strong></p>
      <pre>3</pre>
    </article>
  </body>
</html>
`;

describe('problem parser', () => {
  test('extracts statement sections, constraints, examples, and execution hints', () => {
    const parsed = parseProblemStatementFragment(statementFragment);

    expect(parsed.sections.map((section) => section.title)).toEqual([
      'Cerința',
      'Date de intrare',
      'Date de ieșire',
      'Restricții și precizări',
      'Exemplu:',
    ]);
    expect(parsed.constraints).toEqual([
      '10 ≤ n ≤ 1.000.000.000',
      'Timp de executare: 0.2s',
    ]);
    expect(parsed.executionHints).toEqual({
      timeLimitSeconds: 0.2,
      memoryLimitMb: undefined,
    });
    expect(parsed.examples).toEqual([
      {
        input: '57289',
        output: '11',
        explanation: 'Rezultatul corect este 11.',
      },
    ]);
  });

  test('classifies restricted and hidden endpoint fragments', () => {
    expect(parseProblemEndpointFragment(restrictedSolutionFragment)).toEqual({
      access: 'restricted',
      message: 'N-ai voie să vezi indicațiile!',
      visibleTests: [],
    });

    expect(parseProblemEndpointFragment(hiddenTestsFragment)).toEqual({
      access: 'hidden',
      message: 'Pentru această problemă testele nu sunt vizibile!',
      visibleTests: [],
    });
  });

  test('extracts visible tests from a test endpoint fragment', () => {
    const parsed = parseProblemEndpointFragment(visibleTestsFragment);

    expect(parsed.access).toBe('visible');
    expect(parsed.visibleTests).toEqual([
      {
        title: 'Testul 1',
        input: '3 4',
        output: '7',
      },
    ]);
  });

  test('accepts legacy Romanian diacritics when parsing examples and visible tests', () => {
    const statement = parseProblemStatementFragment(legacyDiacriticsStatementFragment);
    const tests = parseProblemEndpointFragment(legacyDiacriticsVisibleTestsFragment);

    expect(statement.examples).toEqual([
      {
        input: '2705',
        output: '14',
        explanation: 'Suma cifrelor este 14.',
      },
    ]);
    expect(tests.visibleTests).toEqual([
      {
        title: 'Testul 2',
        input: '8 9',
        output: '17',
      },
    ]);
  });

  test('extracts visible tests from the tabular evaluation-tests surface', () => {
    const parsed = parseProblemEndpointFragment(tabularVisibleTestsFragment);

    expect(parsed.access).toBe('visible');
    expect(parsed.visibleTests).toEqual([
      {
        title: 'Testul 1',
        input: '30',
        output: '2 3 5 7',
        score: 20,
        exampleLike: true,
      },
      {
        title: 'Testul 2',
        input: '100',
        output: '2 3 5 7 11',
        score: 20,
        exampleLike: false,
      },
    ]);
  });

  test('extracts a complete public problem record from the full problem page shell', () => {
    const parsed = parseProblemPage(fullProblemPage, 'https://www.pbinfo.ro/probleme/3171/waterreserve');

    expect(parsed).toMatchObject({
      id: 3171,
      slug: 'waterreserve',
      name: 'WaterReserve',
      grade: 9,
      tags: ['Difference Arrays'],
      timeLimitSeconds: 0.2,
      memoryLimitMb: 64,
      author: 'Mirela Mlisan',
      sourceAttribution: 'Admitere UNIBUC 2019',
      categoryChain: [
        { id: 9, name: 'Clasa a 9-a', slug: 'clasa-a-9-a', href: '/?pagina=probleme-lista&clasa=9' },
        { id: 2, name: 'Tablouri unidimensionale (vectori)', slug: 'tablouri-unidimensionale-vectori', href: '/?pagina=probleme-lista&tag=2' },
        { id: 44, name: 'Probleme diverse', slug: 'probleme-diverse', href: '/?pagina=probleme-lista&tag=44' },
      ],
      officialSolutions: {},
      visibleTests: [],
      editorialAvailability: 'unknown',
      metadata: {
        authorHandle: 'Prekzursil',
      },
    });
    expect(parsed.sections.map((section) => section.title)).toEqual([
      'Cerința',
      'Restricții și precizări',
      'Exemplu:',
    ]);
    expect(parsed.examples).toEqual([
      {
        input: '5 3 1 6 1 5',
        output: '3',
      },
    ]);
    expect(parsed.linkedAssets).toEqual([
      {
        url: 'https://www.pbinfo.ro/static/site.css',
        localPath: 'raw-assets/asset-https-www-pbinfo-ro-static-site-css.css',
        kind: 'stylesheet',
        mimeType: 'text/css',
      },
      {
        url: 'https://www.pbinfo.ro/static/problem.js',
        localPath: 'raw-assets/asset-https-www-pbinfo-ro-static-problem-js.js',
        kind: 'script',
        mimeType: 'application/javascript',
      },
    ]);
  });

  test('prefers the summary-row author handle text over unrelated profile links in the shell', () => {
    const html = `
      <html>
        <body>
          <main>
            <a href="/profil/Prekzursil">Andrei Visalon (Prekzursil)</a>
            <h1><a href="/probleme/10/suma-cifrelor">Suma Cifrelor</a></h1>
            <table>
              <tr>
                <th>Postată de</th>
                <th>Autor</th>
              </tr>
              <tr>
                <td>Candale Silviu (silviu)</td>
                <td>Mirela Mlisan</td>
              </tr>
            </table>
            <article>
              <h2>Cerință</h2>
              <p>Calculați suma cifrelor numărului dat.</p>
            </article>
          </main>
        </body>
      </html>
    `;

    const parsed = parseProblemPage(html, 'https://www.pbinfo.ro/probleme/10/suma-cifrelor');

    expect(parsed.metadata).toMatchObject({
      authorHandle: 'silviu',
    });
  });
});

describe('official solution fragment parser', () => {
  test('emits stable SHA-256 hashes per language label when fragment is visible', () => {
    const visibleFragment = `
      <ul class="nav nav-tabs">
        <li><a href="#sol-cpp">C++</a></li>
        <li><a href="#sol-pas">Pascal</a></li>
      </ul>
      <div class="tab-content">
        <div id="sol-cpp"><pre>int main(){return 42;}</pre></div>
        <div id="sol-pas"><pre>begin writeln(42) end.</pre></div>
      </div>
    `;

    const parsed = parseOfficialSolutionFragment(visibleFragment);

    expect(parsed.access).toBe('visible');
    expect(Object.keys(parsed.solutions).sort()).toEqual(['C++', 'Pascal']);
    expect(Object.keys(parsed.solutionHashes).sort()).toEqual(['C++', 'Pascal']);
    expect(parsed.solutionHashes['C++']).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.solutionHashes['Pascal']).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.solutionHashes['C++']).not.toBe(parsed.solutionHashes['Pascal']);

    // Stability across repeat parses.
    const repeat = parseOfficialSolutionFragment(visibleFragment);
    expect(repeat.solutionHashes).toEqual(parsed.solutionHashes);
  });

  test('returns empty solutions and hashes when fragment is restricted', () => {
    const restrictedFragment = `
      <h2>Sursa oficială</h2>
      <div class="alert alert-danger">N-ai voie!</div>
    `;
    const parsed = parseOfficialSolutionFragment(restrictedFragment);
    expect(parsed.access).toBe('restricted');
    expect(parsed.solutions).toEqual({});
    expect(parsed.solutionHashes).toEqual({});
  });
});

describe('category parser', () => {
  test('groups subcategories under the inferred parent category and grade', () => {
    const parsed = parseCategoryPage(categoryPage, 9);

    expect(parsed.grade).toBe(9);
    expect(parsed.categories).toEqual([
      {
        id: 2,
        name: 'Tablouri unidimensionale, vectori',
        slug: 'tablouri-unidimensionale-vectori',
        href: '/probleme/categorii/2/tablouri-unidimensionale-vectori',
        itemListHref: '/?pagina=itemi-evaluare-lista&disciplina=0&clasa=9&tag=2',
        subcategories: [
          {
            id: 9,
            name: 'Parcurgerea vectorilor',
            slug: 'tablouri-unidimensionale-vectori-parcurgerea-vectorilor',
            href: '/probleme/categorii/9/tablouri-unidimensionale-vectori-parcurgerea-vectorilor',
            itemListHref:
              '/?pagina=itemi-evaluare-lista&disciplina=0&clasa=9&tag=2&subtag=9',
          },
          {
            id: 44,
            name: 'Probleme diverse',
            slug: 'tablouri-unidimensionale-vectori-probleme-diverse',
            href: '/probleme/categorii/44/tablouri-unidimensionale-vectori-probleme-diverse',
            itemListHref:
              '/?pagina=itemi-evaluare-lista&disciplina=0&clasa=9&tag=2&subtag=44',
          },
        ],
      },
    ]);
  });
});

describe('user solutions parser', () => {
  test('captures total matches, throttling banners, evaluation entries, and pagination follow-ups', () => {
    const parsed = parseUserSolutionsListPage(
      userSolutionsPage,
      'https://www.pbinfo.ro/solutii/user/Prekzursil',
    );

    expect(parsed.totalMatches).toBe(13968);
    expect(parsed.throttled).toBe(true);
    expect(parsed.currentOffset).toBe(0);
    expect(parsed.pageSize).toBe(50);
    expect(parsed.nextPageUrls.slice(0, 3)).toEqual([
      'https://www.pbinfo.ro/solutii/user/Prekzursil?start=50',
      'https://www.pbinfo.ro/solutii/user/Prekzursil?start=100',
      'https://www.pbinfo.ro/solutii/user/Prekzursil?start=150',
    ]);
    expect(parsed.entries).toEqual([
      {
        user: 'Zeli',
        problemId: 3253,
        problemSlug: 'par-impar3',
        problemName: 'par_impar3',
        evaluationId: 63568050,
        score: undefined,
      },
      {
        user: 'DavidIanchis',
        problemId: 3253,
        problemSlug: 'par-impar3',
        problemName: 'par_impar3',
        evaluationId: 63534271,
        score: undefined,
      },
    ]);
  });

  test('normalizes user handle from profile href when link text contains full name and handle', () => {
    const parsed = parseUserSolutionsListPage(`
      <a href="/profil/Prekzursil">Andrei Visalon (Prekzursil)</a>
      <a href="/probleme/4969/cibernetica">cibernetica</a>
      <a href="/detalii-evaluare/63688922">detalii</a>
    `);

    expect(parsed.entries).toEqual([
      {
        user: 'Prekzursil',
        problemId: 4969,
        problemSlug: 'cibernetica',
        problemName: 'cibernetica',
        evaluationId: 63688922,
        score: undefined,
      },
    ]);
  });

  test('parses table rows to avoid mismatching page-level profile links with unrelated evaluations', () => {
    const parsed = parseUserSolutionsListPage(`
      <a href="/profil/Prekzursil">Andrei Visalon (Prekzursil)</a>
      <table>
        <tr>
          <th>Utilizator</th>
          <th>Problema</th>
          <th>Stare</th>
        </tr>
        <tr>
          <td><a href="/profil/darius_tanasoiu">Darius (darius_tanasoiu)</a></td>
          <td><a href="/probleme/3171/waterreserve">WaterReserve</a></td>
          <td><a href="/detalii-evaluare/63676585">Evaluare finalizată</a></td>
        </tr>
        <tr>
          <td><a href="/profil/Prekzursil">Andrei Visalon (Prekzursil)</a></td>
          <td><a href="/probleme/1/sum">sum</a></td>
          <td><a href="/detalii-evaluare/63332367">Evaluare finalizată</a></td>
        </tr>
      </table>
    `);

    expect(parsed.entries).toEqual([
      {
        user: 'darius_tanasoiu',
        problemId: 3171,
        problemSlug: 'waterreserve',
        problemName: 'WaterReserve',
        evaluationId: 63676585,
        score: undefined,
      },
      {
        user: 'Prekzursil',
        problemId: 1,
        problemSlug: 'sum',
        problemName: 'sum',
        evaluationId: 63332367,
        score: undefined,
      },
    ]);
  });

  test('parses score values from official/source listing rows so targeted harvest can keep 100-point submissions only', () => {
    const parsed = parseUserSolutionsListPage(`
      <table>
        <tr>
          <th>Utilizator</th>
          <th>Problema</th>
          <th>Stare</th>
          <th>Punctaj</th>
        </tr>
        <tr>
          <td><a href="/profil/pbinfo">pbinfo</a></td>
          <td><a href="/probleme/3171/waterreserve">WaterReserve</a></td>
          <td><a href="/detalii-evaluare/70000001">Evaluare finalizată</a></td>
          <td>100</td>
        </tr>
        <tr>
          <td><a href="/profil/pbinfo">pbinfo</a></td>
          <td><a href="/probleme/3171/waterreserve">WaterReserve</a></td>
          <td><a href="/detalii-evaluare/70000002">Evaluare finalizată</a></td>
          <td>70 puncte</td>
        </tr>
      </table>
    `);

    expect(parsed.entries).toEqual([
      {
        user: 'pbinfo',
        problemId: 3171,
        problemSlug: 'waterreserve',
        problemName: 'WaterReserve',
        evaluationId: 70000001,
        score: 100,
      },
      {
        user: 'pbinfo',
        problemId: 3171,
        problemSlug: 'waterreserve',
        problemName: 'WaterReserve',
        evaluationId: 70000002,
        score: 70,
      },
    ]);
  });
});
