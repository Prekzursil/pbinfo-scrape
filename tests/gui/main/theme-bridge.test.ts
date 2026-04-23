import { describe, expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';

import { createThemeBridge } from '../../../src/gui/main/theme-bridge.js';

interface FakeNativeTheme extends EventEmitter {
  themeSource: 'system' | 'light' | 'dark';
  shouldUseDarkColors: boolean;
}

function createFakeNativeTheme(
  initial: FakeNativeTheme['themeSource'],
): FakeNativeTheme {
  const emitter = new EventEmitter() as FakeNativeTheme;
  emitter.themeSource = initial;
  emitter.shouldUseDarkColors = initial === 'dark';
  return emitter;
}

describe('theme-bridge', () => {
  test('getTheme returns effective + preference from nativeTheme', () => {
    const nativeTheme = createFakeNativeTheme('system');
    const bridge = createThemeBridge({
      nativeTheme,
      getPreference: () => 'auto',
      setPreference: vi.fn(),
      broadcast: vi.fn(),
    });

    expect(bridge.getTheme()).toEqual({
      effective: 'light',
      preference: 'auto',
    });
  });

  test('setTheme persists preference and updates nativeTheme.themeSource', () => {
    const nativeTheme = createFakeNativeTheme('system');
    const setPreference = vi.fn();
    const bridge = createThemeBridge({
      nativeTheme,
      getPreference: () => 'auto',
      setPreference,
      broadcast: vi.fn(),
    });

    const result = bridge.setTheme({ preference: 'dark' });

    expect(setPreference).toHaveBeenCalledWith('dark');
    expect(nativeTheme.themeSource).toBe('dark');
    expect(result).toEqual({ effective: 'dark', preference: 'dark' });
  });

  test('auto preference broadcasts theme:changed when OS flips', () => {
    const nativeTheme = createFakeNativeTheme('system');
    const broadcast = vi.fn();
    createThemeBridge({
      nativeTheme,
      getPreference: () => 'auto',
      setPreference: vi.fn(),
      broadcast,
    });

    nativeTheme.shouldUseDarkColors = true;
    nativeTheme.emit('updated');

    expect(broadcast).toHaveBeenCalledWith({ effective: 'dark' });
  });

  test('explicit preference does NOT broadcast when OS flips', () => {
    const nativeTheme = createFakeNativeTheme('light');
    const broadcast = vi.fn();
    createThemeBridge({
      nativeTheme,
      getPreference: () => 'light',
      setPreference: vi.fn(),
      broadcast,
    });

    nativeTheme.shouldUseDarkColors = true;
    nativeTheme.emit('updated');

    expect(broadcast).not.toHaveBeenCalled();
  });
});
