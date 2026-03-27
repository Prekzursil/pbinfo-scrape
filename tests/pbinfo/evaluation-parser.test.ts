import { describe, expect, test } from 'vitest';

import { parseEvaluationPage } from '../../src/pbinfo/parsers/evaluation.js';

const evaluationPage = `
<div id="rezumat">
  <a href="/probleme/4967/collatz1">Collatz1</a>
  <a href="/profil/Prekzursil">Prekzursil</a>
  <table class="table">
    <tr><th>Limbaj</th><td>C++</td></tr>
    <tr><th>Punctaj</th><td>100</td></tr>
    <tr><th>Timp maxim</th><td>0.012 secunde</td></tr>
    <tr><th>Memorie maximă</th><td>2048 KB</td></tr>
    <tr><th>Verdict</th><td>OK.</td></tr>
  </table>
</div>
<div id="detalii">
  <table class="table table-bordered">
    <tr>
      <th>Test</th>
      <th>Timp</th>
      <th>Mesaj evaluare</th>
      <th>Scor</th>
      <th>Scor maxim</th>
      <th>Detalii</th>
    </tr>
    <tr>
      <td>1</td>
      <td>0.001 secunde</td>
      <td>OK.</td>
      <td>5</td>
      <td>5</td>
      <td></td>
    </tr>
    <tr>
      <td>2</td>
      <td>0.012 secunde</td>
      <td>OK.</td>
      <td>5</td>
      <td>5</td>
      <td>fast path</td>
    </tr>
    <tr>
      <th colspan="5">Punctaj total</th>
      <th colspan="2">100</th>
    </tr>
  </table>
</div>
`;

describe('evaluation parser', () => {
  test('extracts problem metadata, summary stats, and per-test verdicts', () => {
    const parsed = parseEvaluationPage(evaluationPage, 63567684);

    expect(parsed).toEqual({
      evaluationId: 63567684,
      problemId: 4967,
      problemSlug: 'collatz1',
      problemName: 'Collatz1',
      user: 'Prekzursil',
      language: 'C++',
      score: 100,
      verdictSummary: 'OK.',
      runtimeSeconds: 0.012,
      memoryKb: 2048,
      sourceAvailable: false,
      sourceCode: undefined,
      compileLog: undefined,
      tests: [
        {
          index: 1,
          runtimeSeconds: 0.001,
          verdict: 'OK.',
          score: 5,
          maxScore: 5,
          details: '',
        },
        {
          index: 2,
          runtimeSeconds: 0.012,
          verdict: 'OK.',
          score: 5,
          maxScore: 5,
          details: 'fast path',
        },
      ],
    });
  });

  test('parses the live paired detail table layout used by PBInfo evaluation pages', () => {
    const liveLikePage = `
      <div id="detalii">
        <table class="table">
          <tr>
            <th>Problema</th><td><a href="/probleme/3716/crossword">Crossword</a></td>
            <th>Operații I/O</th><td>Fișiere</td>
          </tr>
          <tr>
            <th>Limita timp</th><td>0.1 secunde</td>
            <th>Limita memorie</th><td>Total: <code>64 MB</code> / Stivă <code>64 MB</code></td>
          </tr>
          <tr>
            <th>Id soluție</th><td><kbd>#63332367</kbd></td>
            <th>Utilizator</th><td><a href="/profil/Prekzursil">Andrei Visalon (Prekzursil)</a></td>
          </tr>
          <tr>
            <th>Fișier</th><td>crossword.c</td>
            <th>Dimensiune</th><td>6.77 KB</td>
          </tr>
          <tr>
            <th>Data încărcării</th><td>26 Februarie 2026, 14:54</td>
            <th>Scor/rezultat</th><td><span>100 puncte</span></td>
          </tr>
        </table>
      </div>
      <div id="evaluare">
        <h4 class="mb-3">Mesaj compilare</h4>
        <pre>warning: ignoring return value</pre>
        <h4>Rezultat evaluare</h4>
        <table class="table table-condensed">
          <tr>
            <th>Test</th>
            <th>Timp</th>
            <th>Mesaj evaluare</th>
            <th>Scor posibil</th>
            <th>Scor obținut</th>
            <th></th>
          </tr>
          <tr>
            <td>1</td>
            <td>0 secunde</td>
            <td>OK.</td>
            <td>5</td>
            <td>5</td>
            <td><strong>Exemplu</strong></td>
          </tr>
          <tr>
            <td>2</td>
            <td>0.004 secunde</td>
            <td>OK.</td>
            <td>3</td>
            <td>3</td>
            <td></td>
          </tr>
          <tr>
            <th colspan="5">Punctaj total</th>
            <th colspan="2">100</th>
          </tr>
        </table>
      </div>
    `;

    expect(parseEvaluationPage(liveLikePage, 63332367)).toEqual({
      evaluationId: 63332367,
      problemId: 3716,
      problemSlug: 'crossword',
      problemName: 'Crossword',
      user: 'Andrei Visalon (Prekzursil)',
      language: 'c',
      score: 100,
      verdictSummary: '100 puncte',
      runtimeSeconds: 0.1,
      memoryKb: 64,
      sourceAvailable: false,
      sourceCode: undefined,
      compileLog: 'warning: ignoring return value',
      tests: [
        {
          index: 1,
          runtimeSeconds: 0,
          verdict: 'OK.',
          score: 5,
          maxScore: 5,
          details: 'Exemplu',
        },
        {
          index: 2,
          runtimeSeconds: 0.004,
          verdict: 'OK.',
          score: 3,
          maxScore: 3,
          details: '',
        },
      ],
    });
  });

  test('uses the summary-row Utilizator field instead of the first profile link on page', () => {
    const pageWithDecoyProfile = `
      <div id="detalii">
        <a href="/profil/RandomDecoy">Random Decoy</a>
        <table class="table">
          <tr>
            <th>Problema</th><td><a href="/probleme/205/shuffle">Shuffle</a></td>
            <th>Utilizator</th><td><a href="/profil/Prekzursil">Andrei Visalon (Prekzursil)</a></td>
          </tr>
          <tr>
            <th>Scor/rezultat</th><td>100 puncte</td>
            <th>Limbaj</th><td>C++</td>
          </tr>
        </table>
      </div>
      <div id="evaluare">
        <table class="table">
          <tr>
            <th>Test</th>
            <th>Scor posibil</th>
            <th>Scor obținut</th>
            <th>Mesaj evaluare</th>
          </tr>
          <tr>
            <td>1</td>
            <td>10</td>
            <td>10</td>
            <td>OK.</td>
          </tr>
        </table>
      </div>
    `;

    const parsed = parseEvaluationPage(pageWithDecoyProfile, 70000001);
    expect(parsed.user).toBe('Andrei Visalon (Prekzursil)');
    expect(parsed.problemId).toBe(205);
  });

  test('extracts authenticated source code from the dedicated sursa section', () => {
    const pageWithSourceSection = `
      <div id="detalii">
        <table class="table">
          <tr>
            <th>Problema</th><td><a href="/probleme/2404/test">Test</a></td>
            <th>Utilizator</th><td><a href="/profil/Prekzursil">Andrei Visalon (Prekzursil)</a></td>
          </tr>
          <tr>
            <th>Fișier</th><td>test.cpp</td>
            <th>Scor/rezultat</th><td>5 puncte</td>
          </tr>
          <tr>
            <th>Limita timp</th><td>0.04 secunde</td>
            <th>Memorie maximă</th><td>64 KB</td>
          </tr>
        </table>
      </div>
      <div id="evaluare">
        <h4 class="mb-3">Mesaj compilare</h4>
        <pre>warning: unused variable</pre>
        <table class="table table-condensed">
          <tr>
            <th>Test</th>
            <th>Timp</th>
            <th>Mesaj evaluare</th>
            <th>Scor posibil</th>
            <th>Scor obținut</th>
            <th></th>
          </tr>
          <tr>
            <td>1</td>
            <td>0 secunde</td>
            <td>OK.</td>
            <td>5</td>
            <td>5</td>
            <td><strong>Exemplu</strong></td>
          </tr>
        </table>
      </div>
      <div id="sursa">
        <a href="/php/descarca-sursa.php?id=10017347">Descarcă test.cpp</a>
        <pre class="code_cpp">#include&lt;iostream&gt;
using namespace std;

int main() {
  cout &lt;&lt; 42;
  return 0;
}</pre>
      </div>
    `;

    const parsed = parseEvaluationPage(pageWithSourceSection, 10017347);

    expect(parsed.sourceAvailable).toBe(true);
    expect(parsed.sourceCode).toContain('#include<iostream>');
    expect(parsed.sourceCode).toContain('cout << 42;');
    expect(parsed.compileLog).toBe('warning: unused variable');
  });

  test('ignores navbar problem links like /probleme/marcate when resolving the evaluated problem', () => {
    const authenticatedLayoutWithNavDecoy = `
      <nav id="bara_navigare">
        <a href="/probleme/marcate">Problemele mele</a>
      </nav>
      <div id="detalii">
        <table class="table">
          <tr>
            <th>Problema</th><td><a href="/probleme/2404/test">Test</a></td>
            <th>Utilizator</th><td><a href="/profil/Prekzursil">Andrei Visalon (Prekzursil)</a></td>
          </tr>
          <tr>
            <th>Fișier</th><td>test.cpp</td>
            <th>Scor/rezultat</th><td>100 puncte</td>
          </tr>
        </table>
      </div>
      <div id="evaluare">
        <table class="table table-condensed">
          <tr>
            <th>Test</th>
            <th>Timp</th>
            <th>Mesaj evaluare</th>
            <th>Scor posibil</th>
            <th>Scor obținut</th>
            <th></th>
          </tr>
          <tr>
            <td>1</td>
            <td>0 secunde</td>
            <td>OK.</td>
            <td>5</td>
            <td>5</td>
            <td></td>
          </tr>
        </table>
      </div>
      <div id="sursa">
        <pre class="code_cpp">int main(){return 0;}</pre>
      </div>
    `;

    const parsed = parseEvaluationPage(authenticatedLayoutWithNavDecoy, 10113533);

    expect(parsed.problemId).toBe(2404);
    expect(parsed.problemSlug).toBe('test');
    expect(parsed.problemName).toBe('Test');
    expect(parsed.sourceAvailable).toBe(true);
    expect(parsed.sourceCode).toContain('int main(){return 0;}');
  });
});
