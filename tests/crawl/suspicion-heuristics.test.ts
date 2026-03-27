import { describe, expect, test } from 'vitest';

import { detectSuspicionFlags } from '../../src/crawl/archive-crawler.js';

describe('detectSuspicionFlags', () => {
  test('flags repeated scalar input branching on exact literals', () => {
    const source = `
      #include <iostream>
      using namespace std;
      int main() {
        int n;
        cin >> n;
        if (n == 1) {
          cout << 41;
        } else if (n == 2) {
          cout << 73;
        } else if (n == 3) {
          cout << 99;
        }
      }
    `;

    expect(detectSuspicionFlags(source)).toContain('input-branching');
  });

  test('flags tiny exact-input constant-output cheats even with a single hardcoded branch', () => {
    const source = `
      #include <iostream>
      using namespace std;

      int main() {
        int n;
        cin >> n;
        if (n == 1) return 0;
        cout << 42;
      }
    `;

    expect(detectSuspicionFlags(source)).toContain('input-branching');
  });

  test('does not flag ordinary validation or threshold checks as input branching', () => {
    const source = `
      #include <iostream>
      #include <cmath>
      using namespace std;

      int main() {
        int n;
        cin >> n;
        int ok = 1;
        for (int d = 2; d <= sqrt(n) && ok == 1; d++) {
          if (n % d == 0) ok = 0;
        }
        if (ok == 1 && n > 1) cout << "DA";
        else cout << "NU";
        return 0;
      }
    `;

    expect(detectSuspicionFlags(source)).not.toContain('input-branching');
  });

  test('does not flag larger numeric implementations as literal-pairs just for using many constants', () => {
    const source = `
      #include <cstdio>
      #include <deque>
      #define MAX_N 100000
      using namespace std;

      int v[MAX_N+1], n, k;
      deque<int> deck;

      int main() {
        FILE *fin = fopen("secvk.in", "r");
        FILE *fout = fopen("secvk.out", "w");
        fscanf(fin, "%d%d", &n, &k);
        int best = -1;
        for (int i = 1; i <= n; i++) {
          fscanf(fin, "%d", &v[i]);
          if (i <= k) {
            deck.push_back(v[i]);
          }
        }
        fprintf(fout, "%d", best);
      }
    `;

    expect(detectSuspicionFlags(source)).not.toContain('literal-pairs');
  });

  test('does not flag normal primality counting logic as input branching', () => {
    const source = `
      #include<bits/stdc++.h>
      using namespace std;

      int nrprim(int x)
      {
          if(x<=1)
              return 0;
          if(x%2==0&&x!=2)
              return 0;
          for(int d=3;d*d<=x;d+=2)
              if(x%d==0)
                  return 0;
          return 1;
      }

      int main()
      {
          int n,m,i,k=0;
          cin>>n>>m;
          if(n>m)
              swap(n,m);
          for(i=n;i<=m;i++)
              if(nrprim(i)==1)
                  k++;
          cout<<k;
      }
    `;

    expect(detectSuspicionFlags(source)).not.toContain('input-branching');
  });

  test('does not flag sentinel-style accumulation logic as input branching', () => {
    const source = `
      #include <iostream>
      using namespace std;
      int main()
      {
          int s=0,i=1;
          while(i!=0)
          {
              cin>>i;
              if(i%2==0)
                  s=s+i;
              if(i==0)
                  cout<<s;
          }
          return 0;
      }
    `;

    expect(detectSuspicionFlags(source)).not.toContain('input-branching');
  });

  test('treats file-based or stream-based reads as input, not constant-output', () => {
    const source = `
      #include <fstream>
      using namespace std;

      ifstream fin("passwd.in");
      ofstream fout("passwd.out");

      int main() {
        int n;
        fin >> n;
        if (n == 0) {
          fout << "nu exista";
          return 0;
        }
        fout << n;
      }
    `;

    expect(detectSuspicionFlags(source)).not.toContain('constant-output');
  });

  test('does not flag normal indexed character checks as input branching', () => {
    const source = `
      #include<bits/stdc++.h>
      using namespace std;
      int main()
      {
          string s;
          getline(cin,s);
          if(s[0]!=' ')
              s[0]=toupper(s[0]);
          if(s[s.length()-1]!=' ')
              s[s.length()-1]=toupper(s[s.length()-1]);
          for(int i=0;i<=s.length()-1;i++)
              {
                  if(s[i]!=' ')
                      if(s[i-1]==' ' || s[i+1]==' ')
                          s[i]=toupper(s[i]);
              }
          cout<<s;
      }
    `;

    expect(detectSuspicionFlags(source)).not.toContain('input-branching');
  });

  test('does not flag sentinel loops that only compare one input variable to zero', () => {
    const source = `
      #include <iostream>
      using namespace std;

      int main() {
        int s = 0, i = 1;
        while (i != 0) {
          cin >> i;
          if (i % 2 == 0) {
            s += i;
          }
          if (i == 0) {
            cout << s;
          }
        }
        return 0;
      }
    `;

    expect(detectSuspicionFlags(source)).not.toContain('input-branching');
  });
});
