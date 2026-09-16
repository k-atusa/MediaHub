'use client';

import * as React from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ClientOnly } from '@/components/ClientOnly';
import { AppShell } from '@/components/AppShell';
import { Icon } from '@/components/Icon';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useSessionContext } from '@/context/SessionContext';
import { decryptFileBytes, getFolderPid, getOriginalSize, fromHex, wipe } from '@/lib/crypto';
import { mediaUrl } from '@/lib/api';
import { registerVideoStream, unregisterVideoStream, getVideoStreamUrl } from '@/lib/videoStream';

export default function ViewerPage(): React.JSX.Element {
  return (
    <ClientOnly fallback={<div className="mh-login" />}>
      <Viewer />
    </ClientOnly>
  );
}

function Viewer(): React.JSX.Element {
  const router = useRouter();
  const { session, clearSession } = useSessionContext();
  const query = router.query;

  const folder = (query.folder as string) || (typeof window !== 'undefined' ? sessionStorage.getItem('currentFolderName') || '' : '');
  const filePid = (query.pid as string) || (typeof window !== 'undefined' ? sessionStorage.getItem('currentFilePid') || '' : '');
  const fileName = (query.name as string) || (typeof window !== 'undefined' ? sessionStorage.getItem('currentFileName') || '' : '');
  const fileKeyHex = (query.key as string) || (typeof window !== 'undefined' ? sessionStorage.getItem('currentFileKey') || '' : '');
  const folderKeyHex = (query.fk as string) || (typeof window !== 'undefined' ? sessionStorage.getItem('currentFolderKey') || '' : '');
  const storedFolderId = typeof window !== 'undefined' ? sessionStorage.getItem('currentFolderId') || '' : '';

  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const isVideo = ['mp4', 'webm', 'mov', 'mkv'].includes(ext);

  const [bytes, setBytes] = React.useState<Uint8Array | null>(null);
  const [objectUrl, setObjectUrl] = React.useState<string | null>(null);
  const [streamUrl, setStreamUrl] = React.useState<string | null>(null);
  const [textPreview, setTextPreview] = React.useState<string>('');
  const [error, setError] = React.useState<string | null>(null);
  const [downloading, setDownloading] = React.useState(false);
  const [delOpen, setDelOpen] = React.useState(false);

  React.useEffect(() => {
    if (!session) router.replace('/');
  }, [session, router]);

  React.useEffect(() => {
    if (!router.isReady && !fileKeyHex) return;
    if (!filePid || !fileKeyHex) return;
    let cancelled = false;

    (async () => {
      try {
        const folderPid = folderKeyHex ? getFolderPid(fromHex(folderKeyHex)) : storedFolderId;
        if (!folderPid) throw new Error('Missing folder identifier');

        // Video: Stream on-the-fly via Service Worker without loading the entire file into RAM
        if (isVideo) {
          const fk = fromHex(fileKeyHex);
          const origSize = getOriginalSize(fk);
          const registered = await registerVideoStream({
            folderId: folderPid,
            filePid,
            fileKeyHex,
            originalSize: origSize,
            fileName,
          });
          if (cancelled) return;
          if (registered) {
            setStreamUrl(getVideoStreamUrl(folderPid, filePid));
            return;
          }
          console.warn('[Viewer] Service worker registration timed out, falling back to direct download');
        }

        // Non-video (or fallback): download and decrypt full buffer
        const resp = await fetch(mediaUrl(folderPid, filePid, 'dat'));
        if (!resp.ok) throw new Error(`Failed to fetch media file (${resp.status})`);
        const dat = new Uint8Array(await resp.arrayBuffer());
        const fk = fromHex(fileKeyHex);
        const origSize = getOriginalSize(fk);
        const out = await decryptFileBytes(dat, fk, origSize);
        if (cancelled) return;
        setBytes(out);

        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) {
          const blob = new Blob([out as any], { type: `image/${ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext}` });
          setObjectUrl(URL.createObjectURL(blob));
        } else if (['mp4', 'webm', 'mov', 'mkv'].includes(ext)) {
          const mime = ext === 'mp4' ? 'video/mp4' : ext === 'webm' ? 'video/webm' : 'video/mp4';
          setObjectUrl(URL.createObjectURL(new Blob([out as any], { type: mime })));
        } else if (['txt', 'md', 'json', 'csv', 'log', 'xml', 'html', 'css', 'js', 'ts', 'tsx', 'jsx'].includes(ext)) {
          setTextPreview(new TextDecoder().decode(out));
        } else if (ext === 'pdf') {
          setObjectUrl(URL.createObjectURL(new Blob([out as any], { type: 'application/pdf' })));
        } else {
          const blob = new Blob([out as any], { type: 'application/octet-stream' });
          setObjectUrl(URL.createObjectURL(blob));
        }
      } catch (e) {
        console.error('Viewer decryption error:', e);
        if (!cancelled) setError((e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      if (isVideo) {
        unregisterVideoStream(filePid);
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, filePid, fileKeyHex, folderKeyHex, storedFolderId, fileName, isVideo]);

  const handleDownload = async (): Promise<void> => {
    if (bytes) {
      const blob = new Blob([bytes as any]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    // Video streaming mode: download and decrypt on-demand for saving
    if (!filePid || !fileKeyHex) return;
    setDownloading(true);
    try {
      const folderPid = folderKeyHex ? getFolderPid(fromHex(folderKeyHex)) : storedFolderId;
      const resp = await fetch(mediaUrl(folderPid, filePid, 'dat'));
      if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
      const dat = new Uint8Array(await resp.arrayBuffer());
      const fk = fromHex(fileKeyHex);
      const origSize = getOriginalSize(fk);
      const out = await decryptFileBytes(dat, fk, origSize);
      const blob = new Blob([out as any]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      wipe(out);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!filePid || !session) return;
    try {
      const folderPid = folderKeyHex ? getFolderPid(fromHex(folderKeyHex)) : storedFolderId;
      if (folderPid) {
        await fetch(mediaUrl(folderPid, filePid, 'dat'), { method: 'DELETE' });
        await fetch(mediaUrl(folderPid, filePid, 'thumb'), { method: 'DELETE' });
      }
      router.replace(`/folder?folder=${encodeURIComponent(folder)}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!session) return <></>;

  return (
    <AppShell
      username={session.username}
      activeFolder={folder}
      showSidebar
      onLogout={() => {
        clearSession();
        router.replace('/');
      }}
    >
      <div className="mh-viewer">
        <div className="mh-viewer__bar">
          <Link href={`/folder?folder=${encodeURIComponent(folder)}`} aria-label="Back to folder">
            <md-icon-button aria-label="Back">
              <Icon symbol="arrow_back" ariaLabel="" />
            </md-icon-button>
          </Link>
          <h1 className="mh-viewer__title">{fileName}</h1>
          <md-icon-button
            onClick={handleDownload}
            disabled={(!bytes && !streamUrl) || downloading}
            aria-label="Download"
          >
            <Icon symbol="download" ariaLabel="" />
          </md-icon-button>
          <md-icon-button onClick={() => setDelOpen(true)} aria-label="Delete">
            <Icon symbol="delete" ariaLabel="" />
          </md-icon-button>
        </div>

        <div className="mh-viewer__stage">
          {!bytes && !streamUrl && !error && (
            <div style={{ color: 'var(--md-sys-color-on-surface-variant)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <md-circular-progress indeterminate />
              <span>{isVideo ? 'Preparing video stream…' : 'Decrypting media…'}</span>
            </div>
          )}
          {downloading && (
            <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--md-sys-color-inverse-surface)', color: 'var(--md-sys-color-inverse-on-surface)', padding: '10px 20px', borderRadius: 8, zIndex: 1000, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
              Preparing full download…
            </div>
          )}
          {error && (
            <div style={{ color: 'var(--md-sys-color-error)' }}>{error}</div>
          )}
          {streamUrl && isVideo && (
            <video
              src={streamUrl}
              controls
              playsInline
              className="mh-viewer__content"
              style={{ maxHeight: '75vh', width: '100%', borderRadius: 'var(--mh-radius-md)' }}
            />
          )}
          {objectUrl && ext.match(/^(jpg|jpeg|png|gif|webp|bmp|svg)$/) && (
            <img src={objectUrl} alt={fileName} className="mh-viewer__content" />
          )}
          {objectUrl && ext === 'pdf' && (
            <iframe src={objectUrl} title={fileName} className="mh-viewer__content" style={{ width: '90vw', height: '75vh' }} />
          )}
          {objectUrl && !streamUrl && isVideo && (
            <video src={objectUrl} controls className="mh-viewer__content" />
          )}
          {!objectUrl && !streamUrl && textPreview && (
            <pre
              className="mh-viewer__content"
              style={{
                background: 'var(--md-sys-color-surface-container)',
                padding: 'var(--mh-space-4)',
                borderRadius: 'var(--mh-radius-md)',
                maxWidth: 'min(900px, 100%)',
                maxHeight: '70vh',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                fontFamily: 'monospace',
                fontSize: 14,
                color: 'var(--md-sys-color-on-surface)',
              }}
            >
              {textPreview}
            </pre>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={delOpen}
        title="Delete file?"
        message={`Permanently delete "${fileName}"?`}
        destructive
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDelOpen(false)}
      />
    </AppShell>
  );
}