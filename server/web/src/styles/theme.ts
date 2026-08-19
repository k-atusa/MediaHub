import { argbFromHex, themeFromSourceColor, applyTheme as applyMaterialTheme } from '@material/material-color-utilities';

export type ThemeMode = 'light' | 'dark';

export const SEED_COLOR = '#0B57D0';
export const THEME_STORAGE_KEY = 'mediahub:theme';

export function getInitialMode(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light';
  }
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
  return stored === 'dark' ? 'dark' : 'light';
}

export function saveMode(mode: ThemeMode): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(THEME_STORAGE_KEY, mode);
}

export function applyTheme(mode: ThemeMode, seed = SEED_COLOR): void {
  if (typeof document === 'undefined') {
    return;
  }

  const argb = argbFromHex(seed);
  const theme = themeFromSourceColor(argb);
  const target = document.documentElement;

  target.setAttribute('data-theme', mode);
  applyMaterialTheme(theme, { target, darkMode: mode === 'dark' });
}
