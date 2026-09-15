'use client';

import * as React from 'react';
import type { KeyMaterial } from '@/lib/crypto';
import { loadStoredSession, storeSession } from '@/lib/session';

export interface SessionContextValue {
  session: KeyMaterial | null;
  setSession: (session: KeyMaterial | null) => void;
  clearSession: () => void;
  isReady: boolean;
}

const SessionContext = React.createContext<SessionContextValue | undefined>(undefined);

export function useSessionContext(): SessionContextValue {
  const value = React.useContext(SessionContext);
  if (!value) {
    throw new Error('useSessionContext must be used within a SessionProvider');
  }
  return value;
}

interface SessionProviderProps {
  children: React.ReactNode;
}

export function SessionProvider({ children }: SessionProviderProps): React.JSX.Element {
  const [session, setSessionState] = React.useState<KeyMaterial | null>(null);
  const [isReady, setIsReady] = React.useState(false);

  React.useEffect(() => {
    setSessionState(loadStoredSession());
    setIsReady(true);
  }, []);

  const setSession = React.useCallback((next: KeyMaterial | null) => {
    setSessionState(next);
    storeSession(next);
  }, []);

  const clearSession = React.useCallback(() => {
    setSession(null);
  }, [setSession]);

  return (
    <SessionContext.Provider value={{ session, setSession, clearSession, isReady }}>
      {children}
    </SessionContext.Provider>
  );
}