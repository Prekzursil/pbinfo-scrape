import { describe, expect, test } from 'vitest';

import { sanitizeArchiveHtml } from '../../../src/pbinfo/html/sanitize-archive-html.js';

describe('sanitizeArchiveHtml', () => {
  test('strips <script> tags', () => {
    const out = sanitizeArchiveHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).toContain('<p>hi</p>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
  });

  test('strips event handler attributes', () => {
    const out = sanitizeArchiveHtml('<a href="#" onclick="alert(1)">x</a>');
    expect(out).not.toContain('onclick');
    expect(out).toContain('>x</a>');
    expect(out).toContain('href="#"');
  });

  test('strips javascript: URIs from href', () => {
    const out = sanitizeArchiveHtml(
      '<a href="javascript:alert(1)">boom</a>',
    );
    expect(out).not.toContain('javascript:');
  });

  test('preserves benign formatting', () => {
    const input =
      '<h1>Title</h1><p><strong>bold</strong> <em>em</em></p><pre><code>cout &lt;&lt; 1;</code></pre>';
    const out = sanitizeArchiveHtml(input);
    expect(out).toContain('<h1>Title</h1>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>em</em>');
    expect(out).toContain('<pre>');
    expect(out).toContain('<code>');
  });

  test('preserves data:image/* but strips data:text/html', () => {
    const img =
      '<img src="data:image/png;base64,aaa" alt="x" />';
    expect(sanitizeArchiveHtml(img)).toContain('data:image/png');

    const bad =
      '<img src="data:text/html,<script>alert(1)</script>" alt="x" />';
    const cleaned = sanitizeArchiveHtml(bad);
    expect(cleaned).not.toContain('data:text/html');
    expect(cleaned).not.toContain('<script');
  });

  test('preserves tables + list structure', () => {
    const table =
      '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>v</td></tr></tbody></table>';
    const out = sanitizeArchiveHtml(table);
    expect(out).toContain('<table>');
    expect(out).toContain('<thead>');
    expect(out).toContain('<tbody>');
    expect(out).toContain('<th>h</th>');
    expect(out).toContain('<td>v</td>');

    const list = '<ul><li>one</li><li>two</li></ul>';
    expect(sanitizeArchiveHtml(list)).toBe(list);
  });

  test('strips inline style attributes', () => {
    const out = sanitizeArchiveHtml('<p style="color:red">x</p>');
    expect(out).not.toContain('style=');
    expect(out).toContain('<p>x</p>');
  });
});
