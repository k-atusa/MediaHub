'use client';

import * as React from 'react';
import {
  applyTheme,
  getInitialPreference,
  resolveTheme,
  savePreference,
  type ThemePreference,
  type ResolvedTheme,
  type ThemeMode,
} from '@/styles/theme';

export interface ThemeContextValue {
  preference: ThemePreference;
  resolvedMode: ResolvedTheme;
  setPreference: (pref: ThemePreference) => void;
  cyclePreference: () => void;
  /** Backward-compatible accessors */
  mode: ThemePreference;
  setMode: (mode: ThemePreference) => void;
  toggleMode: () => void;
}

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined);

export function useThemeContext(): ThemeContextValue {
  const value = React.useContext(ThemeContext);
  if (!value) {
    throw new Error('useThemeContext must be used within a ThemeProvider');
  }
  return value;
}

interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps): React.JSX.Element {
  const [preference, setPreferenceState] = React.useState<ThemePreference>('auto');
  const [resolvedMode, setResolvedMode] = React.useState<ResolvedTheme>('light');

  // Initialize from storage or system on mount
  React.useEffect(() => {
    const initialPref = getInitialPreference();
    const initialResolved = resolveTheme(initialPref);
    setPreferenceState(initialPref);
    setResolvedMode(initialResolved);
    applyTheme(initialResolved);

    // Listen for system theme changes when preference is 'auto'
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleSystemChange = () => {
        setPreferenceState((currentPref) => {
          if (currentPref === 'auto') {
            const nextResolved = mediaQuery.matches ? 'dark' : 'light';
            setResolvedMode(nextResolved);
            applyTheme(nextResolved);
          }
          return currentPref;
        });
      };

      mediaQuery.addEventListener('change', handleSystemChange);
      return () => mediaQuery.removeEventListener('change', handleSystemChange);
    }
  }, []);

  const setPreference = React.useCallback((nextPref: ThemePreference) => {
    setPreferenceState(nextPref);
    savePreference(nextPref);
    const nextResolved = resolveTheme(nextPref);
    setResolvedMode(nextResolved);
    applyTheme(nextResolved);
  }, []);

  const cyclePreference = React.useCallback(() => {
    setPreferenceState((curr) => {
      // Cycle: auto -> light -> dark -> auto
      const next: ThemePreference = curr === 'auto' ? 'light' : curr === 'light' ? 'dark' : 'auto';
      savePreference(next);
      const nextResolved = resolveTheme(next);
      setResolvedMode(nextResolved);
      applyTheme(nextResolved);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        preference,
        resolvedMode,
        setPreference,
        cyclePreference,
        mode: preference,
        setMode: setPreference,
        toggleMode: cyclePreference,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
