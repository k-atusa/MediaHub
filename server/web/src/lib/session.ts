import type { KeyMaterial } from './crypto';

const SESSION_KEY = 'mediahub:session';

export function loadStoredSession(): KeyMaterial | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'userHash' in parsed &&
      'maskedUserKey' in parsed &&
      'username' in parsed
    ) {
      return parsed as KeyMaterial;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function storeSession(session: KeyMaterial | null): void {
  if (typeof window === 'undefined') return;
  if (session) {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    window.sessionStorage.removeItem(SESSION_KEY);
  }
}