// REST API helpers that talk to the Go backend at `server/server.go`.
// The backend API surface is:
//   GET/POST/DELETE /api/userdata/{userHash}
//   GET/POST/DELETE /api/storage/{folderPid}/names   (POST/DELETE require X-User-Hash)
//   GET/POST/DELETE /api/media/{folderPid}/{filePid}/{dat|thumb}  (POST/DELETE require X-User-Hash)
//   POST  /api/trim/{folderPid}                     (X-User-Hash, body {pids: string[]})
//   GET   /api/notice

export const API_BASE = '';

export interface ApiError {
  status: number;
  message: string;
}

export function userDataUrl(userHash: string): string {
  return `${API_BASE}/api/userdata/${encodeURIComponent(userHash)}`;
}

export function folderNamesUrl(folderPid: string): string {
  return `${API_BASE}/api/storage/${encodeURIComponent(folderPid)}/names`;
}

export function mediaUrl(folderPid: string, filePid: string, type: 'dat' | 'thumb'): string {
  return `${API_BASE}/api/media/${encodeURIComponent(folderPid)}/${encodeURIComponent(filePid)}/${type}`;
}

export function trimUrl(folderPid: string): string {
  return `${API_BASE}/api/trim/${encodeURIComponent(folderPid)}`;
}

export function noticeUrl(): string {
  return `${API_BASE}/api/notice`;
}

export async function fetchNotice(): Promise<string> {
  const res = await fetch(noticeUrl());
  if (!res.ok) {
    return '';
  }
  const data = (await res.json()) as { notice?: unknown };
  return typeof data.notice === 'string' ? data.notice : '';
}

export async function fetchUserData(userHash: string): Promise<unknown> {
  const res = await fetch(userDataUrl(userHash));
  if (!res.ok) {
    throw new Error(`Failed to fetch user data: ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch raw user blob bytes (encrypted). Used by the crypto layer to decrypt
 * the folder map with the user's symmetric key.
 * Returns null when the user does not exist (HTTP 404).
 */
export async function fetchUserBlob(userHash: string): Promise<Uint8Array | null> {
  const res = await fetch(userDataUrl(userHash));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch user blob: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function saveUserData(
  userHash: string,
  payload: unknown,
  options: { inviteCode?: string; oldHash?: string } = {}
): Promise<void> {
  const headers = new Headers();
  if (options.inviteCode) {
    headers.set('X-Invite-Code', options.inviteCode);
  }
  if (options.oldHash) {
    headers.set('X-Old-Hash', options.oldHash);
  }
  const res = await fetch(userDataUrl(userHash), {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Failed to save user data: ${res.status}`);
  }
}

export async function deleteUser(userHash: string): Promise<void> {
  const res = await fetch(userDataUrl(userHash), { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`Failed to delete user: ${res.status}`);
  }
}

export async function fetchFolderNames(folderPid: string): Promise<unknown> {
  const res = await fetch(folderNamesUrl(folderPid));
  if (!res.ok) {
    throw new Error(`Failed to fetch folder: ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch raw folder names blob (encrypted). Used by the crypto layer to
 * decrypt the file map with the folder's symmetric key.
 * Returns null when the folder does not exist (HTTP 404).
 */
export async function fetchFolderBlob(folderPid: string): Promise<Uint8Array | null> {
  const res = await fetch(folderNamesUrl(folderPid));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch folder blob: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function saveFolderNames(folderPid: string, userHash: string, payload: unknown): Promise<void> {
  const res = await fetch(folderNamesUrl(folderPid), {
    method: 'POST',
    headers: { 'X-User-Hash': userHash },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Failed to save folder: ${res.status}`);
  }
}

export async function deleteFolder(folderPid: string, userHash: string): Promise<void> {
  const res = await fetch(folderNamesUrl(folderPid), {
    method: 'DELETE',
    headers: { 'X-User-Hash': userHash },
  });
  if (!res.ok) {
    throw new Error(`Failed to delete folder: ${res.status}`);
  }
}

export async function trimFolder(folderPid: string, userHash: string, pids: string[]): Promise<void> {
  const res = await fetch(trimUrl(folderPid), {
    method: 'POST',
    headers: { 'X-User-Hash': userHash, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pids }),
  });
  if (!res.ok) {
    throw new Error(`Failed to trim folder: ${res.status}`);
  }
}

export async function deleteMedia(
  folderPid: string,
  filePid: string,
  type: 'dat' | 'thumb',
  userHash: string
): Promise<void> {
  const res = await fetch(mediaUrl(folderPid, filePid, type), {
    method: 'DELETE',
    headers: { 'X-User-Hash': userHash },
  });
  if (!res.ok) {
    throw new Error(`Failed to delete media (${type}): ${res.status}`);
  }
}

// Re-export session helpers from the dedicated session module so existing
// imports of `loadStoredSession` / `storeSession` from this file keep working.
export { loadStoredSession, storeSession } from './session';
