'use client';

import * as React from 'react';
import { applyTheme, getInitialMode, saveMode, type ThemeMode } from '@/styles/theme';

export interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
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
  const [mode, setModeState] = React.useState<ThemeMode>('light');

  React.useEffect(() => {
    const initial = getInitialMode();
    setModeState(initial);
    applyTheme(initial);
  }, []);

  const setMode = React.useCallback((next: ThemeMode) => {
    setModeState(next);
    saveMode(next);
    applyTheme(next);
  }, []);

  const toggleMode = React.useCallback(() => {
    setModeState((current) => {
      const next = current === 'light' ? 'dark' : 'light';
      saveMode(next);
      applyTheme(next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, setMode, toggleMode }}>
      {children}
    </ThemeContext.Provider>
  );
}
