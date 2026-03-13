import { describe, expect, test } from 'vitest';

import {
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
  test('captures total matches, throttling banners, and evaluation entries', () => {
    const parsed = parseUserSolutionsListPage(userSolutionsPage);

    expect(parsed.totalMatches).toBe(13968);
    expect(parsed.throttled).toBe(true);
    expect(parsed.entries).toEqual([
      {
        user: 'Zeli',
        problemId: 3253,
        problemSlug: 'par-impar3',
        problemName: 'par_impar3',
        evaluationId: 63568050,
      },
      {
        user: 'DavidIanchis',
        problemId: 3253,
        problemSlug: 'par-impar3',
        problemName: 'par_impar3',
        evaluationId: 63534271,
      },
    ]);
  });
});
