import DOMPurify from 'isomorphic-dompurify';

const ALLOWED_TAGS = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'code',
  'pre',
  'blockquote',
  'a',
  'img',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'div',
  'span',
  'br',
  'hr',
];

const ALLOWED_ATTR = ['href', 'src', 'alt', 'width', 'height', 'class'];

// Matches: safe http(s), mailto:, anchors, relative URLs, and data:image/*.
// Rejects javascript:, data:text/*, vbscript:, file://, etc.
const SAFE_URI_RE =
  /^(?:(?:https?|mailto):|data:image\/[a-z+.-]+;|[#/?.])|^[^:]*$/iu;

// Tags whose INNER content is stripped when encountered (script bodies,
// style bodies, etc.). For everything else we keep content of stripped tags
// so text nodes inside harmless unknown elements still render.
const FORBID_CONTENTS = ['script', 'style', 'iframe', 'object', 'embed'];

export function sanitizeArchiveHtml(input: string): string {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: SAFE_URI_RE,
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['style'],
    FORBID_CONTENTS,
  });
}
