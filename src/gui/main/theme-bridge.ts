import type { EventEmitter } from 'node:events';

export type ThemePreference = 'auto' | 'light' | 'dark';
export type EffectiveTheme = 'light' | 'dark';

export interface ThemeBridgeDeps {
  readonly nativeTheme: EventEmitter & {
    themeSource: 'system' | 'light' | 'dark';
    shouldUseDarkColors: boolean;
  };
  readonly getPreference: () => ThemePreference;
  readonly setPreference: (preference: ThemePreference) => void;
  readonly broadcast: (event: { effective: EffectiveTheme }) => void;
}

export interface ThemeBridge {
  readonly getTheme: () => {
    readonly effective: EffectiveTheme;
    readonly preference: ThemePreference;
  };
  readonly setTheme: (input: { preference: ThemePreference }) => {
    readonly effective: EffectiveTheme;
    readonly preference: ThemePreference;
  };
}

export function createThemeBridge(deps: ThemeBridgeDeps): ThemeBridge {
  const handleOsUpdate = (): void => {
    if (deps.getPreference() === 'auto') {
      deps.broadcast({
        effective: effectiveFor(deps.nativeTheme, 'auto'),
      });
    }
  };

  deps.nativeTheme.on('updated', handleOsUpdate);
  applyPreferenceToNativeTheme(deps.nativeTheme, deps.getPreference());

  return {
    getTheme() {
      return {
        effective: effectiveFor(deps.nativeTheme, deps.getPreference()),
        preference: deps.getPreference(),
      };
    },
    setTheme({ preference }) {
      deps.setPreference(preference);
      applyPreferenceToNativeTheme(deps.nativeTheme, preference);
      const effective = effectiveFor(deps.nativeTheme, preference);
      // Broadcast so every renderer window (including the one that
      // initiated the change) gets the new effective theme. Without this,
      // the initiating renderer has to handle the set() promise itself to
      // update its data-theme; the broadcast path also covers any peer
      // windows that share the same preference store.
      deps.broadcast({ effective });
      return { effective, preference };
    },
  };
}

function effectiveFor(
  nativeTheme: ThemeBridgeDeps['nativeTheme'],
  preference: ThemePreference,
): EffectiveTheme {
  if (preference === 'light') return 'light';
  if (preference === 'dark') return 'dark';
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function applyPreferenceToNativeTheme(
  nativeTheme: ThemeBridgeDeps['nativeTheme'],
  preference: ThemePreference,
): void {
  nativeTheme.themeSource = preference === 'auto' ? 'system' : preference;
}
