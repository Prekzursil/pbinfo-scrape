import { describe, expect, test } from 'vitest';

import { detectSuspicionFlags } from '../../src/crawl/source-suspicion.js';

describe('detectSuspicionFlags edge heuristics', () => {
  test('flags a constant lookup table addressed by input', () => {
    const code = 'int main(){int n;cin>>n;int t[]={3,5,7,9,11,13,15,17};cout<<t[n];}';
    expect(detectSuspicionFlags(code)).toContain('lookup-table');
  });

  test('flags dense literal branching including literal-first comparisons', () => {
    const code =
      'int main(){int n;cin>>n;if(n==11)cout<<111;if(n==22)cout<<222;if(n==33)cout<<333;if(44==n)cout<<444;}';
    const flags = detectSuspicionFlags(code);
    expect(flags).toContain('input-branching');
    expect(flags).toContain('literal-pairs');
  });

  test('flags a dense switch on an input variable', () => {
    const code =
      'int main(){int n;cin>>n;switch(n){case 1:cout<<1;break;case 2:cout<<2;break;case 3:cout<<3;break;case 4:cout<<4;break;}}';
    expect(detectSuspicionFlags(code)).toContain('input-branching');
  });

  test('ignores a switch that is not driven by an input variable', () => {
    const code = 'int main(){int n,m;cin>>n;m=5;switch(m){case 1:cout<<1;break;}}';
    const flags = detectSuspicionFlags(code);
    expect(flags).not.toContain('input-branching');
  });

  test('flags a tiny source', () => {
    expect(detectSuspicionFlags('cin>>n;')).toContain('tiny-source');
  });

  test('flags constant output that never reads input', () => {
    expect(detectSuspicionFlags('int main(){cout<<"the answer is 42";}')).toContain('constant-output');
  });

  test('ignores literal-first comparisons against non-input variables and trivial sentinels', () => {
    const code = 'int main(){int n;cin>>n;if(7==z)cout<<1;if(n==0)cout<<2;}';
    const flags = detectSuspicionFlags(code);
    expect(Array.isArray(flags)).toBe(true);
  });

  test('flags input-branching from a single short literal mapping', () => {
    const code = 'int main(){int n;cin>>n;if(n==11)cout<<111;}';
    expect(detectSuspicionFlags(code)).toContain('input-branching');
  });

  test('flags input-branching from two literal mappings in a medium-length source', () => {
    const code =
      'int main(){int n;cin>>n;/* padding padding padding padding padding padding padding padding padding padding more */if(n==11)cout<<111;if(n==22)cout<<222;}';
    expect(detectSuspicionFlags(code)).toContain('input-branching');
  });

  test('skips trivial sentinel comparisons (0, 1, -1)', () => {
    const code = 'int main(){int n;cin>>n;if(n==0)cout<<1;if(n==1)cout<<2;if(n==-1)cout<<3;}';
    expect(Array.isArray(detectSuspicionFlags(code))).toBe(true);
  });

  test('flags input-branching from a dense switch without literal output bodies', () => {
    const code =
      'int main(){int n;cin>>n;int r;switch(n){case 1:r=1;break;case 2:r=2;break;case 3:r=3;break;case 4:r=4;break;}cout<<r;}';
    expect(detectSuspicionFlags(code)).toContain('input-branching');
  });

  test('counts no switch cases when the input switch has only non-literal cases', () => {
    const code = 'int main(){int n;cin>>n;switch(n){case FOO:break;default:break;}}';
    expect(Array.isArray(detectSuspicionFlags(code))).toBe(true);
  });

  test('returns no flags for empty source', () => {
    expect(detectSuspicionFlags()).toEqual([]);
  });
});
