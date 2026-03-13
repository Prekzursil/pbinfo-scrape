import { describe, expect, test } from 'vitest';

import {
  desktopPreferencesUpdateSchema,
  createProfileInputSchema,
  desktopBrowserImportInputSchema,
  desktopCredentialLoginInputSchema,
  guiJobStartInputSchema,
  guiWorkspaceSelectionSchema,
} from '../../src/gui/shared/contracts.js';

describe('desktop ipc contracts', () => {
  test('rejects malformed workspace selection payloads', () => {
    const result = guiWorkspaceSelectionSchema.safeParse({
      workspaceRoot: 42,
    });

    expect(result.success).toBe(false);
  });

  test('accepts serializable profile creation payloads and rejects plaintext credential persistence', () => {
    expect(
      createProfileInputSchema.parse({
        profileId: 'alpha',
        label: 'Primary account',
        userHandle: 'Prekzursil',
        provenance: {
          type: 'browser-import',
          browser: 'edge',
        },
        sessionCookies: [
          {
            key: 'SESSION_ID',
            value: 'cookie-value',
            domain: 'www.pbinfo.ro',
            path: '/',
            secure: true,
            httpOnly: true,
          },
        ],
      }),
    ).toEqual(
      expect.objectContaining({
        profileId: 'alpha',
        label: 'Primary account',
      }),
    );

    const badResult = createProfileInputSchema.safeParse({
      profileId: 'alpha',
      label: 'Primary account',
      userHandle: 'Prekzursil',
      provenance: {
        type: 'login',
      },
      username: 'Prekzursil',
      password: 'TEST_PASSWORD_123',
      sessionCookies: [],
    });

    expect(badResult.success).toBe(false);
  });

  test('accepts job-start payloads for supported desktop actions only', () => {
    expect(
      guiJobStartInputSchema.parse({
        kind: 'crawl',
        snapshotId: 'acceptance-20260310b',
        profileId: 'alpha',
        detail: {
          scope: 'all',
        },
      }),
    ).toEqual(
      expect.objectContaining({
        kind: 'crawl',
      }),
    );

    const badResult = guiJobStartInputSchema.safeParse({
      kind: 'publish',
      snapshotId: 'acceptance-20260310b',
    });

    expect(badResult.success).toBe(false);
  });

  test('accepts GUI-safe auth payloads without persisting plaintext credentials in profile storage', () => {
    expect(
      desktopCredentialLoginInputSchema.parse({
        profileId: 'alpha',
        label: 'Primary account',
        userHandle: 'Prekzursil',
        username: 'Prekzursil',
        password: 'secret',
      }),
    ).toEqual(
      expect.objectContaining({
        profileId: 'alpha',
        label: 'Primary account',
      }),
    );

    expect(
      desktopBrowserImportInputSchema.parse({
        profileId: 'alpha-browser',
        label: 'Primary browser session',
        browser: 'edge',
        profileName: 'Default',
      }),
    ).toEqual(
      expect.objectContaining({
        browser: 'edge',
      }),
    );

    const badBrowserImport = desktopBrowserImportInputSchema.safeParse({
      profileId: 'alpha-browser',
      label: 'Primary browser session',
      browser: 'firefox',
    });

    expect(badBrowserImport.success).toBe(false);
  });

  test('accepts only supported verbosity modes for desktop preferences', () => {
    expect(
      desktopPreferencesUpdateSchema.parse({
        verbosityMode: 'verbose',
      }),
    ).toEqual({
      verbosityMode: 'verbose',
    });

    const badResult = desktopPreferencesUpdateSchema.safeParse({
      verbosityMode: 'chatty',
    });

    expect(badResult.success).toBe(false);
  });
});
