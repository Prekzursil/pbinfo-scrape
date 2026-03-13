import { createHash } from 'node:crypto';

export function sanitizeSegment(pathname: string): string {
  return (
    pathname
      .replace(/^\/+/, '')
      .replace(/\./g, '-')
      .replace(/\/+/g, '-')
      .replace(/[^a-zA-Z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'root'
  );
}

export function buildPageFilename(rawUrl: string): string {
  const url = new URL(rawUrl);
  const protocol = url.protocol.replace(':', '');
  const hostname = url.hostname.replace(/\./g, '-');
  const path = url.pathname === '/' ? 'root' : sanitizeSegment(url.pathname);
  const suffix = buildQuerySuffix(url);
  return `page-${protocol}-${hostname}-${path}${suffix}.html`;
}

export function buildPageRecordFilename(rawUrl: string): string {
  return buildPageFilename(rawUrl).replace(/\.html$/, '.json');
}

export function buildAssetFilename(rawUrl: string, contentType?: string | null): string {
  const url = new URL(rawUrl);
  const protocol = url.protocol.replace(':', '');
  const hostname = url.hostname.replace(/\./g, '-');
  const baseName = sanitizeSegment(url.pathname);
  const extension = inferAssetExtension(url.pathname, contentType ?? null);
  const suffix = buildQuerySuffix(url);
  return `asset-${protocol}-${hostname}-${baseName}${suffix}.${extension}`;
}

export function buildRawAssetLocalPath(rawUrl: string, contentType?: string | null): string {
  return `raw-assets/${buildAssetFilename(rawUrl, contentType)}`;
}

function inferAssetExtension(pathname: string, contentType: string | null): string {
  const explicitExtension = pathname.split('.').pop();
  if (explicitExtension && explicitExtension !== pathname) {
    return explicitExtension.replace(/[^a-zA-Z0-9]/g, '') || 'bin';
  }

  if (contentType?.includes('css')) {
    return 'css';
  }
  if (contentType?.includes('javascript')) {
    return 'js';
  }
  if (contentType?.includes('json')) {
    return 'json';
  }
  return 'bin';
}

function buildQuerySuffix(url: URL): string {
  if (!url.search) {
    return '';
  }

  const hash = createHash('sha1')
    .update(`${url.pathname}${url.search}`)
    .digest('hex')
    .slice(0, 10);
  return `-q${hash}`;
}
