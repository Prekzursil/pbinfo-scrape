import { describe, expect, test } from 'vitest';

import { rankProblemSubmissions } from '../../src/ranking/rank-submissions.js';
import type { SourceRecord, SubmissionRecord } from '../../src/types/records.js';

function submission(overrides: Partial<SubmissionRecord>): SubmissionRecord {
  return {
    evaluationId: 1,
    problemId: 3253,
    problemSlug: 'par-impar3',
    language: 'cpp',
    user: 'Prekzursil',
    score: 100,
    verdictSummary: 'OK.',
    runtimeSeconds: 0.01,
    memoryKb: 256,
    sourceAvailable: true,
    sourceCode: [
      '#include <iostream>',
      'using namespace std;',
      'int main() {',
      '  int n;',
      '  cin >> n;',
      '  cout << (n % 2);',
      '  return 0;',
      '}',
    ].join('\n'),
    suspicionFlags: [],
    tests: [],
    fetchedAt: '2026-03-10T00:00:00.000Z',
    provenance: ['user-solutions'],
    ...overrides,
  };
}

describe('rankProblemSubmissions', () => {
  test('prefers clean 100-point submissions over suspicious faster ones', () => {
    const ranked = rankProblemSubmissions([
      submission({ evaluationId: 10, language: 'cpp', runtimeSeconds: 0.015 }),
      submission({
        evaluationId: 11,
        language: 'cpp',
        runtimeSeconds: 0.001,
        sourceCode: 'int main(){int n;cin>>n;if(n==1)return 0;cout<<42;}',
        suspicionFlags: ['constant-output'],
      }),
      submission({
        evaluationId: 12,
        language: 'py',
        score: 80,
        verdictSummary: 'Time limit exceeded',
        runtimeSeconds: 1.9,
        sourceCode: [
          'def solve():',
          '    n = int(input())',
          '    value = n % 2',
          '    print(value)',
          '',
          'solve()',
        ].join('\n'),
      }),
    ]);

    expect(ranked.bestUserOverallEvaluationId).toBe(10);
    expect(ranked.bestTrustworthyOverallEvaluationId).toBe(10);
    expect(ranked.bestUserPerLanguage).toEqual({
      cpp: 10,
      py: 12,
    });
    expect(ranked.bestTrustworthyPerLanguage).toEqual({
      cpp: 10,
    });
    expect(ranked.bestFastPerLanguage).toEqual({
      cpp: 11,
      py: 12,
    });
    expect(ranked.suspiciousCandidateEvaluationIds).toEqual([11]);
    expect(ranked.bestOfficialPerLanguage).toEqual({});
  });

  test('recomputes suspicion from source code instead of trusting stale persisted flags', () => {
    const ranked = rankProblemSubmissions([
      submission({
        evaluationId: 45,
        language: 'cpp',
        sourceCode: `
          #include <iostream>
          #include <cmath>
          using namespace std;

          int main()
          {
              int n;
              cin>>n;
              int ok=1;
              for(int d=2;d<=sqrt(n) && ok==1;d++)
                  if(n%d==0) ok=0;
              if(ok==1 && n>1) cout<<"DA";
              else cout<<"NU";
              return 0;
          }
        `,
        suspicionFlags: ['input-branching'],
      }),
    ]);

    expect(ranked.bestTrustworthyOverallEvaluationId).toBe(45);
    expect(ranked.bestTrustworthyPerLanguage).toEqual({
      cpp: 45,
    });
    expect(ranked.suspiciousCandidateEvaluationIds).toEqual([]);
  });

  test('does not let constant-output alone block legitimate fixed-output submissions', () => {
    const ranked = rankProblemSubmissions([
      submission({
        evaluationId: 46,
        language: 'cpp',
        sourceCode: [
          '#include <iostream>',
          'using namespace std;',
          'int main() {',
          '  cout << "Sarbatori fericite!";',
          '  return 0;',
          '}',
        ].join('\n'),
        suspicionFlags: ['constant-output'],
      }),
    ]);

    expect(ranked.bestTrustworthyOverallEvaluationId).toBe(46);
    expect(ranked.bestTrustworthyPerLanguage).toEqual({
      cpp: 46,
    });
    expect(ranked.suspiciousCandidateEvaluationIds).toEqual([]);
  });

  test('does not let lookup-table alone block legitimate precomputed math helpers', () => {
    const ranked = rankProblemSubmissions([
      submission({
        evaluationId: 47,
        language: 'cpp',
        sourceCode: [
          '#include <bits/stdc++.h>',
          'using namespace std;',
          'int det(int n) {',
          '  int v[11]={1,2,6,24,120,720,5040,40320,362880,3628800,39916800};',
          '  if(n==0) return 1;',
          '  for(int i=0;i<=10;i++){',
          '    if(n-v[i]<0) return i==0 ? v[i] : v[i-1];',
          '    if(n-v[i]==0) return n;',
          '  }',
          '  return v[10];',
          '}',
          'int main(){int n;cin>>n;cout<<det(n);}',
        ].join('\n'),
        suspicionFlags: ['lookup-table'],
      }),
    ]);

    expect(ranked.bestTrustworthyOverallEvaluationId).toBe(47);
    expect(ranked.bestTrustworthyPerLanguage).toEqual({
      cpp: 47,
    });
    expect(ranked.suspiciousCandidateEvaluationIds).toEqual([]);
  });

  test('deduplicates repeated submissions of the same source per language and still honors overrides', () => {
    const ranked = rankProblemSubmissions(
      [
        submission({
          evaluationId: 20,
          language: 'cpp',
          runtimeSeconds: 0.012,
          fetchedAt: '2026-03-01T00:00:00.000Z',
          sourceCode: 'int main(){return 0;}',
        }),
        submission({
          evaluationId: 21,
          language: 'cpp',
          runtimeSeconds: 0.012,
          fetchedAt: '2026-03-03T00:00:00.000Z',
          sourceCode: 'int main(){return 0;}',
        }),
        submission({
          evaluationId: 22,
          language: 'cpp',
          runtimeSeconds: 0.011,
          fetchedAt: '2026-03-02T00:00:00.000Z',
          sourceCode: 'int main(){int x=1;return x;}',
        }),
      ],
      [],
      {
        forcedBestEvaluationIds: {
          cpp: 21,
        },
      },
    );

    expect(ranked.bestUserOverallEvaluationId).toBe(21);
    expect(ranked.bestUserPerLanguage.cpp).toBe(21);
    expect(ranked.duplicateEvaluationIds).toEqual([20]);
    expect(ranked.orderedUserEvaluationIds.slice(0, 2)).toEqual([21, 22]);
  });

  test('tracks best official source per language separately from user evaluations', () => {
    const officialSources: SourceRecord[] = [
      {
        sourceId: 'official-3253-cpp',
        kind: 'official',
        problemId: 3253,
        language: 'cpp',
        score: 100,
        sourceAvailable: true,
        sourceCode: 'int main() { return 0; }',
        suspicionFlags: [],
        provenance: ['official'],
      },
      {
        sourceId: 'official-3253-py',
        kind: 'official',
        problemId: 3253,
        language: 'py',
        score: 100,
        sourceAvailable: true,
        sourceCode: 'print(42)',
        suspicionFlags: [],
        provenance: ['official'],
      },
    ];

    const ranked = rankProblemSubmissions(
      [submission({ evaluationId: 30, language: 'cpp' })],
      officialSources,
    );

    expect(ranked.bestUserPerLanguage).toEqual({ cpp: 30 });
    expect(ranked.bestOfficialPerLanguage).toEqual({
      cpp: 'official-3253-cpp',
      py: 'official-3253-py',
    });
  });

  test('treats longer recursive/tree-style solutions flagged only as input-branching as trustworthy', () => {
    const ranked = rankProblemSubmissions([
      submission({
        evaluationId: 52,
        language: 'cpp',
        sourceCode: `#include <fstream>
using namespace std;
ifstream fin("countprimsub.in");
ofstream fout("countprimsub.out");
int n,x, s[1001], d[1001],info[1001];
int prim(int n)
{
    if(n==0 || n==1)
        return 0;
    else if(n%2==0&&n!=2)
        return 0;
    else
        for(int d=3;d*d<=n;d=d+2)
            if(n%d==0)
                return 0;
    return 1;
}
int count(int k)
{
    if(k==0) return 0;
    else
    {
        if(prim(info[k]))
            return 1+count(s[k])+count(d[k]);
        else
            return count(s[k])+count(d[k]);
    }
}
int main()
{
    fin>>n;
    for(int i=1;i<=n;i++)
        fin>>info[i]>>s[i]>>d[i];
    int k,y;
    fin>>k;
    for(int i=1;i<=k;i++)
    {
        fin>>y;
        fout<<count(y)<<'\\n';
    }
}`,
        suspicionFlags: ['input-branching'],
      }),
    ]);

    expect(ranked.bestTrustworthyOverallEvaluationId).toBe(52);
    expect(ranked.bestTrustworthyPerLanguage).toEqual({
      cpp: 52,
    });
  });

  test('treats compact but legitimate decision logic flagged as input-branching/literal-pairs as trustworthy', () => {
    const ranked = rankProblemSubmissions([
      submission({
        evaluationId: 53,
        language: 'cpp',
        sourceCode: `#include <iostream>
using namespace std;
int main()
{
    int s,c,n;
    cin>>s>>c>>n;
    if(s%c==0&&s%n==0)
        cout<<"CN";
    else if(s%c==0)
        cout<<'C';
    else if(s%n==0)
        cout<<'N';
    else
        cout<<"nimic";
    return 0;
}`,
        suspicionFlags: ['input-branching', 'literal-pairs'],
      }),
    ]);

    expect(ranked.bestTrustworthyOverallEvaluationId).toBe(53);
    expect(ranked.bestTrustworthyPerLanguage).toEqual({
      cpp: 53,
    });
  });

  test('excludes fragment-only or sub-100 official sources from per-language official winners', () => {
    const officialSources: SourceRecord[] = [
      {
        sourceId: 'official-3253-cpp-fragment',
        kind: 'official',
        problemId: 3253,
        language: 'cpp',
        score: 0,
        sourceAvailable: true,
        sourceCode: '// editorial fragment',
        provenanceType: 'official-fragment',
        suspicionFlags: [],
        provenance: ['official-fragment'],
      },
      {
        sourceId: 'official-3253-cpp-accepted',
        kind: 'official',
        problemId: 3253,
        language: 'cpp',
        score: 100,
        sourceAvailable: true,
        sourceCode: 'int main() { return 0; }',
        suspicionFlags: [],
        provenance: ['official'],
      },
      {
        sourceId: 'official-3253-py-partial',
        kind: 'official',
        problemId: 3253,
        language: 'py',
        score: 40,
        sourceAvailable: true,
        sourceCode: 'print(1)',
        suspicionFlags: [],
        provenance: ['official'],
      },
    ];

    const ranked = rankProblemSubmissions(
      [submission({ evaluationId: 30, language: 'cpp' })],
      officialSources,
    );

    expect(ranked.bestOfficialPerLanguage).toEqual({
      cpp: 'official-3253-cpp-accepted',
    });
  });
});
