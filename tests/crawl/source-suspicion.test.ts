import { describe, expect, test } from 'vitest';

import { detectSuspicionFlags } from '../../src/crawl/source-suspicion.js';

describe('source-suspicion detectSuspicionFlags', () => {
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

  test('does not flag ordinary validation logic as input branching', () => {
    const source = `
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

  test('does not flag sentinel loops with unrelated constant-output branches as input branching', () => {
    const source = `
      #include <iostream>
      #include <climits>
      using namespace std;
      int main()
      {
          int n,MAX=INT_MIN;
          cin>>n;
          while(n!=0)
          {
              if(n>MAX)
                  MAX=n;
              cin>>n;
          }
          if(MAX<0)
              cout<<"NU EXISTA";
          else
              cout<<MAX;
          return 0;
      }
    `;

    expect(detectSuspicionFlags(source)).not.toContain('input-branching');
  });

  test('flags tiny literal-mapping cheats as input branching', () => {
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

  test('treats getchar_unlocked-based readers as real input, not constant-output', () => {
    const source = `
      #include <stdio.h>
      #ifndef getchar_unlocked
      #define getchar_unlocked getchar
      #endif

      static int rd_int(void){
          int c = getchar_unlocked();
          while(c!=EOF && (c<'0' || c>'9')) c = getchar_unlocked();
          int x = 0;
          while(c>='0' && c<='9'){ x = x*10 + (c-'0'); c = getchar_unlocked(); }
          return x;
      }

      int main(void){
          int n = rd_int();
          printf("%d\\n", n);
          return 0;
      }
    `;

    expect(detectSuspicionFlags(source)).not.toContain('constant-output');
  });

  test('does not flag euclidean gcd branching as hardcoded input branching', () => {
    const source = `
      #include<bits/stdc++.h>
      using namespace std;
      int main()
      {
          int a,b,x,y,r;
          cin>>a>>b;
          x=a;
          y=b;
          r=a%b;
          while(r!=0)
          {
              a=b;
              b=r;
              r=a%b;
          }
          if(b==1)
          cout<<"PIE";
          else
          cout<<"NOPIE";
          return 0;
      }
    `;

    expect(detectSuspicionFlags(source)).not.toContain('input-branching');
  });

  test('does not flag calendar-style month branching as hardcoded input branching', () => {
    const source = `
      #include <iostream>
      using namespace std;
      int main()
      {
          unsigned int z,l,a;
          cin>>z>>l>>a;
          if(l==2)
              if(a%4==0 && a%100!=0 || a%400==0)
              {
                  if(z<29 && z>0)
                      z=z+1;
                  else if(z==29)
                  {
                      z=1;
                      l=l+1;
                  }
                  cout<<z<<" "<<l<<" "<<a;
                  return 0;
              }
              else
              {
                  if(z<28 && z>0)
                      z=z+1;
                  else if(z==28)
                  {
                      z=1;
                      l=l+1;
                  }
                  cout<<z<<" "<<l<<" "<<a;
                  return 0;
              }
          if(l==1 || l==3 || l==5 || l==7 || l==8 || l==10)
          {
              if(z<31 && z>0)
                  z=z+1;
              else if(z==31)
              {
                  z=1;
                  l=l+1;
              }
              cout<<z<<" "<<l<<" "<<a;
          }
      }
    `;

    expect(detectSuspicionFlags(source)).not.toContain('input-branching');
  });

  test('does not flag command dispatch over input strings as hardcoded input branching', () => {
    const source = `
      #include<bits/stdc++.h>
      using namespace std;
      int main()
      {
          string s;
          vector<int> v;
          int n,x;
          cin>>n;
          for(int i=1;i<=n;i++)
          {
              cin>>s;
              if(s=="push")
              {
                  cin>>x;
                  v.push_back(x);
              }
              if(s=="pop")
                  v.pop_back();
              if(s=="top")
                  cout<<v[v.size()-1]<<'\\n';
          }
      }
    `;

    expect(detectSuspicionFlags(source)).not.toContain('input-branching');
  });

  test('does not treat helper functions that only print formatting literals as constant-output', () => {
    const source = `
      #include<bits/stdc++.h>
      using namespace std;

      void afismat(int a[100][100],int n,int m)
      {
          for(int i=0;i<n;i++)
          {
              for(int j=0;j<m;j++)
                  cout<<a[i][j]<<" ";
              cout<<'\\n';
          }
      }
    `;

    expect(detectSuspicionFlags(source)).not.toContain('constant-output');
  });

  test('does not flag iterative lookup-table math helpers as suspicious lookup tables', () => {
    const source = `
      #include<bits/stdc++.h>
      using namespace std;

      int det(int n)
      {
          int v[11]={1,2,6,24,120,720,5040,40320,362880,3628800,39916800};
          if(n==0)
              return 1;
          for(int i=0;i<=11;i++)
          {
              if(n-v[i]<0)
                  if(abs(n-v[i])>n-v[i-1])
                      return v[i-1];
                  else
                      return v[i];
              if(n-v[i]==0)
                  return n;
          }
          return 0;
      }
    `;

    expect(detectSuspicionFlags(source)).not.toContain('lookup-table');
  });
});
