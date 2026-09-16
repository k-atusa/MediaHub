import { argbFromHex, themeFromSourceColor, hexFromArgb, applyTheme as applyMaterialTheme } from '@material/material-color-utilities';

export type ThemePreference = 'auto' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
/** Backward-compatible alias for existing callers */
export type ThemeMode = ThemePreference;

export const SEED_COLOR = '#0B57D0';
export const THEME_STORAGE_KEY = 'mediahub:theme';

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getInitialPreference(): ThemePreference {
  if (typeof window === 'undefined') {
    return 'auto';
  }
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemePreference | null;
  if (stored === 'light' || stored === 'dark' || stored === 'auto') {
    return stored;
  }
  return 'auto'; // Default is auto (system)
}

/** Backward-compatible getter */
export function getInitialMode(): ThemeMode {
  return getInitialPreference();
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'auto') {
    return getSystemTheme();
  }
  return preference;
}

export function savePreference(pref: ThemePreference): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(THEME_STORAGE_KEY, pref);
}

/** Backward-compatible saver */
export function saveMode(mode: ThemePreference): void {
  savePreference(mode);
}

export function applyTheme(resolvedMode: ResolvedTheme, seed = SEED_COLOR): void {
  if (typeof document === 'undefined') {
    return;
  }

  const argb = argbFromHex(seed);
  const theme = themeFromSourceColor(argb);
  const target = document.documentElement;

  target.setAttribute('data-theme', resolvedMode);
  const isDark = resolvedMode === 'dark';
  applyMaterialTheme(theme, { target, dark: isDark });

  // Material Design 3 surface container tonal tokens (harmonized with seed)
  const n = theme.palettes.neutral;
  const containerTokens: Record<string, string> = isDark
    ? {
        '--md-sys-color-surface-container-lowest': hexFromArgb(n.tone(4)),
        '--md-sys-color-surface-container-low': hexFromArgb(n.tone(10)),
        '--md-sys-color-surface-container': hexFromArgb(n.tone(14)),
        '--md-sys-color-surface-container-high': hexFromArgb(n.tone(19)),
        '--md-sys-color-surface-container-highest': hexFromArgb(n.tone(24)),
        '--md-sys-color-surface-dim': hexFromArgb(n.tone(6)),
        '--md-sys-color-surface-bright': hexFromArgb(n.tone(28)),
      }
    : {
        '--md-sys-color-surface-container-lowest': hexFromArgb(n.tone(100)),
        '--md-sys-color-surface-container-low': hexFromArgb(n.tone(96)),
        '--md-sys-color-surface-container': hexFromArgb(n.tone(94)),
        '--md-sys-color-surface-container-high': hexFromArgb(n.tone(92)),
        '--md-sys-color-surface-container-highest': hexFromArgb(n.tone(90)),
        '--md-sys-color-surface-dim': hexFromArgb(n.tone(87)),
        '--md-sys-color-surface-bright': hexFromArgb(n.tone(98)),
      };

  for (const [key, val] of Object.entries(containerTokens)) {
    target.style.setProperty(key, val);
  }
}
