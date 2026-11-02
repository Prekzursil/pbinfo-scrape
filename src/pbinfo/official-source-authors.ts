const OFFICIAL_SOURCE_AUTHOR_HANDLES = new Set(['pbinfo']);

export function isOfficialSourceAuthorHandle(handle: string | undefined): boolean {
  if (!handle) {
    return false;
  }

  return OFFICIAL_SOURCE_AUTHOR_HANDLES.has(handle.trim().toLowerCase());
}
