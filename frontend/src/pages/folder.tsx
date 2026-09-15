'use client';

import * as React from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ClientOnly } from '@/components/ClientOnly';
import { AppShell } from '@/components/AppShell';
import { FileGrid } from '@/components/FileGrid';
import type { FileCardAction } from '@/components/FileCard';
import { EmptyState } from '@/components/EmptyState';
import { UploadFAB } from '@/components/UploadFAB';
import { UploadDropZone } from '@/components/UploadDropZone';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { RenameDialog } from '@/components/RenameDialog';
import { ShareDialog } from '@/components/ShareDialog';
import { ChangePasswordDialog } from '@/components/ChangePasswordDialog';
import { ProgressSnackbar } from '@/components/ProgressSnackbar';
import { Icon } from '@/components/Icon';
import { useSessionContext } from '@/context/SessionContext';
import {
  createFileKeyWithSize,
  createFolderKey,
  decryptFileBytes,
  decryptFolderBlobAsync,
  decryptUserBlobAsync,
  detectKind,
  encryptFileBlob,
  fromHex,
  getFilePid,
  getFolderPid,
  loadShareToken,
  makeSession,
  makeShareToken,
  makeThumb,
  mask,
  recoverSessionKey,
  saveFolderBlob,
  saveUserBlob,
  toHex,
} from '@/lib/crypto';
import { deleteFolder, deleteMedia, fetchFolderBlob, fetchUserBlob, folderNamesUrl, mediaUrl, userDataUrl } from '@/lib/api';
import type { FileEntry, FolderEntry } from '@/types/mediahub';

const PAGE_SIZE = 30;

export default function FolderPage(): React.JSX.Element {
  return (
    <ClientOnly
      fallback={
        <div className="mh-login">
          <div className="mh-login__card" />
        </div>
      }
    >
      <FolderView />
    </ClientOnly>
  );
}

function FolderView(): React.JSX.Element {
  const router = useRouter();
  const { session, setSession, clearSession } = useSessionContext();

  // All encrypted state lives here, decrypted once after load.
  const [fldMap, setFldMap] = React.useState<Record<string, Uint8Array>>({});
  const [currentName, setCurrentName] = React.useState<string>('');
  const [currentKey, setCurrentKey] = React.useState<Uint8Array | null>(null);
  const [flsMap, setFlsMap] = React.useState<Record<string, Uint8Array>>({});
  const [page, setPage] = React.useState(1);

  // UI state
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sessionError, setSessionError] = React.useState<string | null>(null);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [renameTarget, setRenameTarget] = React.useState<FileEntry | null>(null);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<{ kind: 'file' | 'folder'; entry: FileEntry | FolderEntry } | null>(null);
  const [shareOpen, setShareOpen] = React.useState<null | 'export' | 'import'>(null);
  const [pwOpen, setPwOpen] = React.useState(false);
  const [snack, setSnack] = React.useState<{ open: boolean; message: string; progress?: number }>({
    open: false,
    message: '',
  });

  // Redirect to login if no session
  React.useEffect(() => {
    if (!session) router.replace('/');
  }, [session, router]);

  // Load user blob on first mount
  React.useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const buf = await fetchUserBlob(session.userHash);
        if (!buf) {
          if (!cancelled) {
            setFldMap({});
            setLoading(false);
          }
          return;
        }
        const userKey = recoverSessionKey(session.maskedUserKey);
        const map = await decryptUserBlobAsync(userKey, buf);
        if (!cancelled) {
          setFldMap(map);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          clearSession();
          setSessionError((e as Error).message || 'Decryption failed');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, clearSession]);

  const handleLogout = React.useCallback(() => {
    clearSession();
    router.replace('/');
  }, [clearSession, router]);

  // When the user selects a different folder from the sidebar, switch to it.
  const switchToFolder = React.useCallback(
    async (name: string, key: Uint8Array) => {
      setCurrentName(name);
      setCurrentKey(key);
      setPage(1);
      setFlsMap({});
      try {
        const pid = getFolderPid(key);
        const buf = await fetchFolderBlob(pid);
        if (!buf) {
          setFlsMap({});
          return;
        }
        const fm = await decryptFolderBlobAsync(key, buf);
        setFlsMap(fm);
      } catch (e) {
        // Empty folder or decryption error (new folder, etc.)
        setFlsMap({});
      }
    },
    []
  );

  // Auto-select first folder when loaded
  React.useEffect(() => {
    if (loading || currentKey || Object.keys(fldMap).length === 0) return;
    const firstName = Object.keys(fldMap)[0];
    switchToFolder(firstName, fldMap[firstName]);
  }, [loading, fldMap, currentKey, switchToFolder]);

  const persistUserBlob = React.useCallback(
    async (next: Record<string, Uint8Array>) => {
      if (!session) return;
      const userKey = recoverSessionKey(session.maskedUserKey);
      const out = await saveUserBlob(session.userHash, userKey, next);
      await fetch(userDataUrl(session.userHash), {
        method: 'POST',
        body: out as any,
      });
    },
    [session]
  );

  const persistFolderBlob = React.useCallback(
    async (fileMap: Record<string, Uint8Array>) => {
      if (!session || !currentKey) return;
      const pid = getFolderPid(currentKey);
      const out = await saveFolderBlob(pid, currentKey, fileMap);
      await fetch(folderNamesUrl(pid), {
        method: 'POST',
        headers: { 'X-User-Hash': session.userHash },
        body: out as any,
      });
    },
    [session, currentKey]
  );

  const handleCreateFolder = async (): Promise<void> => {
    const name = prompt('Folder name:');
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed || fldMap[trimmed]) {
      alert('Invalid or duplicate name.');
      return;
    }
    const key = createFolderKey();
    const next = { ...fldMap, [trimmed]: key };
    setFldMap(next);
    try {
      await persistUserBlob(next);
      switchToFolder(trimmed, key);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handlePickFile = async (files: FileList): Promise<void> => {
    if (!currentKey || !session) return;
    setBusy(true);
    setSnack({ open: true, message: 'Encrypting & uploading…', progress: 0 });
    try {
      const nextFls = { ...flsMap };
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setSnack({ open: true, message: `Encrypting ${file.name}…`, progress: (i / files.length) * 0.5 });
        const fileKey = createFileKeyWithSize(file.size);
        const pid = getFilePid(fileKey);

        const dat = await encryptFileBlob(file, fileKey);
        await fetch(mediaUrl(getFolderPid(currentKey), pid, 'dat'), {
          method: 'POST',
          headers: { 'X-User-Hash': session.userHash, 'Content-Type': 'application/octet-stream' },
          body: dat as any,
        });

        let thumbBytes: Uint8Array | null = null;
        const thumbBlob = await makeThumb(file);
        if (thumbBlob) {
          thumbBytes = new Uint8Array(await thumbBlob.arrayBuffer());
          await fetch(mediaUrl(getFolderPid(currentKey), pid, 'thumb'), {
            method: 'POST',
            headers: { 'X-User-Hash': session.userHash, 'Content-Type': 'application/octet-stream' },
            body: thumbBytes as any,
          });
        }

        nextFls[file.name] = fileKey;
        setFlsMap({ ...nextFls });
        setSnack({ open: true, message: `Saving ${file.name}…`, progress: 0.5 + (i / files.length) * 0.5 });
      }
      await persistFolderBlob(nextFls);
      setSnack({ open: true, message: 'Upload complete' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setTimeout(() => setSnack({ open: false, message: '' }), 2000);
    }
  };

  const handleAction = (action: FileCardAction, file: FileEntry): void => {
    if (action === 'rename') {
      setRenameTarget(file);
      setRenameOpen(true);
    } else if (action === 'delete') {
      setDeleteTarget({ kind: 'file', entry: file });
      setDeleteOpen(true);
    } else if (action === 'download') {
      handleDownload(file);
    } else if (action === 'share') {
      if (!currentKey) return;
      setShareOpen('export');
    }
  };

  const handleRenameConfirm = async (next: string): Promise<void> => {
    if (!renameTarget || !next) {
      setRenameOpen(false);
      setRenameTarget(null);
      return;
    }
    const oldName = renameTarget.name;
    if (oldName === next) {
      setRenameOpen(false);
      setRenameTarget(null);
      return;
    }
    const updated = { ...flsMap };
    const key = updated[oldName];
    delete updated[oldName];
    updated[next] = key;
    setFlsMap(updated);
    setRenameOpen(false);
    setRenameTarget(null);
    try {
      await persistFolderBlob(updated);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleDeleteConfirm = async (): Promise<void> => {
    if (!deleteTarget || !session || !currentKey) return;
    try {
      if (deleteTarget.kind === 'file') {
        const f = deleteTarget.entry as FileEntry;
        const updated = { ...flsMap };
        delete updated[f.name];
        setFlsMap(updated);
        await deleteMedia_(getFolderPid(currentKey), f.pid, session.userHash);
        await persistFolderBlob(updated);
      } else {
        const fd = deleteTarget.entry as FolderEntry;
        const updated = { ...fldMap };
        delete updated[fd.name];
        setFldMap(updated);
        await deleteFolder_(getFolderPid(mask.XOR(fromHex(fd.keyHex))), session.userHash);
        await persistUserBlob(updated);
        if (fd.name === currentName) {
          setCurrentName('');
          setCurrentKey(null);
          setFlsMap({});
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleteOpen(false);
      setDeleteTarget(null);
    }
  };

  const handleDownload = async (file: FileEntry): Promise<void> => {
    if (!currentKey) return;
    try {
      const resp = await fetch(mediaUrl(getFolderPid(currentKey), file.pid, 'dat'));
      if (!resp.ok) {
        setError('Download failed.');
        return;
      }
      const datBytes = new Uint8Array(await resp.arrayBuffer());
      const rawKey = mask.XOR(fromHex(file.keyHex));
      const sizeBytes = rawKey.slice(44, 52);
      const v = new DataView(sizeBytes.buffer, sizeBytes.byteOffset, 8);
      const origSize = Number(v.getBigUint64(0, true));
      const out = await decryptFileBytes(datBytes, rawKey, origSize);
      const blob = new Blob([out as any]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleExportShare = async (password: string): Promise<string | null> => {
    if (!currentKey) return null;
    if (!password) {
      alert('Share password required');
      return null;
    }
    try {
      return await makeShareToken(currentName, currentKey, password);
    } catch (e) {
      alert(`Export failed: ${(e as Error).message}`);
      return null;
    }
  };

  const handleImportShare = async (
    token: string,
    password: string
  ): Promise<{ name: string; pid: string } | null> => {
    if (!session) return null;
    if (!password || !token) {
      alert('Token and password required');
      return null;
    }
    try {
      const r = await loadShareToken(token, password);
      if (!r) {
        alert('Invalid token or password.');
        return null;
      }
      const pid = getFolderPid(r.folderKey);
      const next = { ...fldMap, [r.name]: r.folderKey };
      setFldMap(next);
      await persistUserBlob(next);
      switchToFolder(r.name, r.folderKey);
      return { name: r.name, pid };
    } catch (e) {
      alert(`Import failed: ${(e as Error).message}`);
      return null;
    }
  };

  const handleChangePassword = async (newPw: string): Promise<void> => {
    if (!session) return;
    const newMaterial = await makeSession(session.username, newPw);
    // Re-encrypt user blob with new key, write to new userHash
    const newKey = recoverSessionKey(newMaterial.maskedUserKey);
    const userKey = recoverSessionKey(session.maskedUserKey);
    const enc = await saveUserBlob(newMaterial.userHash, newKey, fldMap);
    await fetch(userDataUrl(newMaterial.userHash), {
      method: 'POST',
      headers: { 'X-Old-Hash': session.userHash, 'Content-Type': 'application/octet-stream' },
      body: enc as any,
    });
    // delete old user blob
    await fetch(userDataUrl(session.userHash), { method: 'DELETE' });
    setSession(newMaterial);
    setPwOpen(false);
  };

  // Build the visible file list for the grid
  const visibleFiles: FileEntry[] = React.useMemo(() => {
    const names = Object.keys(flsMap);
    const start = (page - 1) * PAGE_SIZE;
    const slice = names.slice(start, start + PAGE_SIZE);
    return slice.map((name) => {
      const key = flsMap[name];
      const sizeBytes = key.slice(44, 52);
      const v = new DataView(sizeBytes.buffer, sizeBytes.byteOffset, 8);
      const size = Number(v.getBigUint64(0, true));
      return {
        pid: getFilePid(key),
        name,
        keyHex: toHex(mask.XOR(key)),
        kind: detectKind(name),
        size,
        updatedAt: 0,
      };
    });
  }, [flsMap, page]);

  const totalPages = Math.max(1, Math.ceil(Object.keys(flsMap).length / PAGE_SIZE));

  if (!session) return <></>;

  return (
    <AppShell
      username={session.username}
      activeFolder={currentName}
      onCreateFolder={handleCreateFolder}
      onLogout={handleLogout}
      onSearch={() => {
        /* placeholder */
      }}
    >
      <div className="mh-folder__header">
        <div>
          <nav className="mh-breadcrumbs" aria-label="Breadcrumb">
            <Link href="/folder">My Drive</Link>
            {currentName && <span aria-hidden>/</span>}
            {currentName && <span className="mh-breadcrumbs__current">{currentName}</span>}
          </nav>
          <h1 className="mh-folder__title">{currentName || 'My Drive'}</h1>
        </div>
        <div className="mh-folder__toolbar">
          <md-text-button onClick={() => setShareOpen('import')}>
            <Icon symbol="download" slot="icon" ariaLabel="" />
            Import
          </md-text-button>
          {currentKey && (
            <md-text-button onClick={() => setShareOpen('export')}>
              <Icon symbol="share" slot="icon" ariaLabel="" />
              Share
            </md-text-button>
          )}
          {currentKey && (
            <md-text-button onClick={() => setDeleteOpen(true)}>
              <Icon symbol="delete" slot="icon" ariaLabel="" />
              Delete folder
            </md-text-button>
          )}
          <md-text-button onClick={() => setPwOpen(true)}>
            <Icon symbol="lock_reset" slot="icon" ariaLabel="" />
            Change password
          </md-text-button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 'var(--mh-space-12)', textAlign: 'center', color: 'var(--md-sys-color-on-surface-variant)' }}>
          <md-circular-progress indeterminate />
        </div>
      ) : !currentKey ? (
        <EmptyState
          icon="create_new_folder"
          title="No folder selected"
          description="Create a folder to start uploading encrypted media."
          actionLabel="New folder"
          onAction={handleCreateFolder}
        />
      ) : Object.keys(flsMap).length === 0 ? (
        <EmptyState
          icon="cloud_upload"
          title="This folder is empty"
          description="Drag and drop files anywhere on the page, or use the upload button."
          actionLabel="Upload"
          onAction={() => document.querySelector<HTMLInputElement>('input[type=file]')?.click()}
        />
      ) : (
        <>
          <FileGrid files={visibleFiles} folderName={currentName} onAction={handleAction} />
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 24 }}>
              <md-text-button disabled={page === 1} onClick={() => setPage(page - 1)}>
                Prev
              </md-text-button>
              <span style={{ color: 'var(--md-sys-color-on-surface-variant)' }}>
                {page} / {totalPages}
              </span>
              <md-text-button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Next
              </md-text-button>
            </div>
          )}
        </>
      )}

      <UploadFAB onPick={(files) => handlePickFile(files)} disabled={!currentKey || busy} />
      <UploadDropZone onDrop={(files) => handlePickFile(files)} disabled={!currentKey || busy} />

      <RenameDialog
        open={renameOpen}
        initialName={renameTarget?.name ?? ''}
        onConfirm={handleRenameConfirm}
        onCancel={() => {
          setRenameOpen(false);
          setRenameTarget(null);
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        title={deleteTarget?.kind === 'file' ? 'Delete file?' : 'Delete folder?'}
        message={
          deleteTarget?.kind === 'file'
            ? `Permanently delete "${deleteTarget.entry.name}"? This cannot be undone.`
            : `Permanently delete folder "${(deleteTarget?.entry as FolderEntry)?.name}" and all its files? This cannot be undone.`
        }
        destructive
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeleteOpen(false);
          setDeleteTarget(null);
        }}
      />
      {shareOpen && currentKey && (
        <ShareDialog
          open
          mode={shareOpen}
          onExportConfirm={handleExportShare}
          onImportConfirm={handleImportShare}
          onClose={() => setShareOpen(null)}
        />
      )}
      <ChangePasswordDialog
        open={pwOpen}
        onConfirm={handleChangePassword}
        onCancel={() => setPwOpen(false)}
      />

      {sessionError && (
        <ConfirmDialog
          open
          title="Session Expired or Decryption Failed"
          message={`Your session is invalid or expired (${sessionError}). Please sign in again.`}
          confirmLabel="Sign In"
          cancelLabel="Sign In"
          onConfirm={() => {
            clearSession();
            router.replace('/');
          }}
          onCancel={() => {
            clearSession();
            router.replace('/');
          }}
        />
      )}

      {error && (
        <ConfirmDialog
          open
          title="Error"
          message={error}
          confirmLabel="OK"
          cancelLabel="Dismiss"
          onConfirm={() => setError(null)}
          onCancel={() => setError(null)}
        />
      )}

      <ProgressSnackbar
        open={snack.open}
        message={snack.message}
        progress={snack.progress}
        onClose={() => setSnack({ open: false, message: '' })}
      />
    </AppShell>
  );
}

async function deleteMedia_(folderPid: string, filePid: string, userHash: string): Promise<void> {
  await deleteMedia(folderPid, filePid, 'dat', userHash);
  await deleteMedia(folderPid, filePid, 'thumb', userHash);
}

async function deleteFolder_(folderPid: string, userHash: string): Promise<void> {
  await deleteFolder(folderPid, userHash);
}