import { describe, expect, test } from 'vitest';

import {
  extractLoggedInState,
  extractResolvedHandle,
  extractUserSessionJson,
  pickSessionHandle,
} from '../../src/auth/session-handle.js';

describe('extractUserSessionJson', () => {
  test('returns undefined when no session blob is present', () => {
    expect(extractUserSessionJson('<html><body>no session here</body></html>')).toBeUndefined();
  });

  test('returns undefined when the JSON blob is malformed', () => {
    expect(
      extractUserSessionJson('user_autentificat = {not-json,}; rest of script'),
    ).toBeUndefined();
  });

  test('parses a well-formed embedded user_autentificat record', () => {
    expect(
      extractUserSessionJson('user_autentificat = {"id":7,"username":"alice"};'),
    ).toEqual({ id: 7, username: 'alice' });
  });
});

describe('pickSessionHandle', () => {
  test('returns undefined for non-string values', () => {
    expect(pickSessionHandle(42)).toBeUndefined();
  });

  test('returns undefined for blank strings', () => {
    expect(pickSessionHandle('    ')).toBeUndefined();
  });

  test('extracts a parenthesized handle from a display name', () => {
    expect(pickSessionHandle('Alice (alice123)')).toBe('alice123');
  });

  test('passes plain handle strings through unchanged', () => {
    expect(pickSessionHandle('alice123')).toBe('alice123');
  });
});

describe('extractLoggedInState', () => {
  test('returns true when an authenticated user_autentificat blob is present', () => {
    expect(extractLoggedInState('user_autentificat = {"id":42};')).toBe(true);
  });

  test('falls back to the logout selector when no session blob is present', () => {
    expect(extractLoggedInState('<a href="/logout">Logout</a>')).toBe(true);
  });

  test('reports false when neither session blob nor logout link is present', () => {
    expect(extractLoggedInState('<a href="/login">Login</a>')).toBe(false);
  });
});

describe('extractResolvedHandle', () => {
  test('resolves a handle directly from the session blob', () => {
    expect(
      extractResolvedHandle('user_autentificat = {"id":7,"username":"alice"};'),
    ).toBe('alice');
  });

  test('returns undefined when the page is guest-mode without any logout signal', () => {
    expect(extractResolvedHandle('<html><body>guest mode</body></html>')).toBeUndefined();
  });

  test('falls back to the profile-anchor href when session JSON is missing', () => {
    const html = `
      <a href="/logout">Logout</a>
      <nav><a href="/profil/bobby">Profile</a></nav>
    `;
    expect(extractResolvedHandle(html)).toBe('bobby');
  });

  test('falls back to parenthesized text inside a profile anchor when href is empty', () => {
    const html = `
      <a href="/logout">Logout</a>
      <nav>
        <a href="/profil/">Display name (charlie)</a>
      </nav>
    `;
    expect(extractResolvedHandle(html)).toBe('charlie');
  });

  test('returns undefined when authenticated but no anchor yields a handle', () => {
    const html = `
      <a href="/logout">Logout</a>
      <nav><a href="/profil/">No handle here</a></nav>
    `;
    expect(extractResolvedHandle(html)).toBeUndefined();
  });

  test('returns undefined when session JSON has no matching handle key', () => {
    const html = 'user_autentificat = {"id":42,"display":"x"};';
    expect(extractResolvedHandle(html)).toBeUndefined();
  });
});
