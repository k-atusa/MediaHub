'use client';

import * as React from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ClientOnly } from '@/components/ClientOnly';
import { AppShell } from '@/components/AppShell';
import { Icon } from '@/components/Icon';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useSessionContext } from '@/context/SessionContext';
import { decryptFileBytes, getFolderPid, mask, fromHex } from '@/lib/crypto';
import { mediaUrl } from '@/lib/api';

export default function ViewerPage(): React.JSX.Element {
  return (
    <ClientOnly fallback={<div className="mh-login" />}>
      <Viewer />
    </ClientOnly>
  );
}

function Viewer(): React.JSX.Element {
  const router = useRouter();
  const { session } = useSessionContext();
  const query = router.query;

  const folder = (query.folder as string) ?? '';
  const filePid = (query.pid as string) ?? '';
  const fileName = (query.name as string) ?? '';
  const fileKeyHex = (query.key as string) ?? '';
  const folderKeyHex = (query.fk as string) ?? '';

  const [bytes, setBytes] = React.useState<Uint8Array | null>(null);
  const [objectUrl, setObjectUrl] = React.useState<string | null>(null);
  const [textPreview, setTextPreview] = React.useState<string>('');
  const [error, setError] = React.useState<string | null>(null);
  const [delOpen, setDelOpen] = React.useState(false);

  React.useEffect(() => {
    if (!session) router.replace('/');
  }, [session, router]);

  React.useEffect(() => {
    if (!filePid || !fileKeyHex) return;
    let cancelled = false;
    (async () => {
      try {
        const folderKey = fromHex(folderKeyHex);
        const folderPid = getFolderPid(folderKey);
        const resp = await fetch(mediaUrl(folderPid, filePid, 'dat'));
        if (!resp.ok) throw new Error(`Failed to fetch (${resp.status})`);
        const dat = new Uint8Array(await resp.arrayBuffer());
        const fk = mask.XOR(fromHex(fileKeyHex));
        const sizeBytes = fk.slice(44, 52);
        const v = new DataView(sizeBytes.buffer, sizeBytes.byteOffset, 8);
        const origSize = Number(v.getBigUint64(0, true));
        const out = await decryptFileBytes(dat, fk, origSize);
        if (cancelled) return;
        setBytes(out);
        const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) {
          const blob = new Blob([out as any], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` });
          setObjectUrl(URL.createObjectURL(blob));
        } else if (['mp4', 'webm'].includes(ext)) {
          const mime = ext === 'mp4' ? 'video/mp4' : 'video/webm';
          setObjectUrl(URL.createObjectURL(new Blob([out as any], { type: mime })));
        } else if (['txt', 'md', 'json', 'csv', 'log'].includes(ext)) {
          setTextPreview(new TextDecoder().decode(out));
        } else if (ext === 'pdf') {
          setObjectUrl(URL.createObjectURL(new Blob([out as any], { type: 'application/pdf' })));
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePid, fileKeyHex, folderKeyHex, fileName]);

  const handleDownload = (): void => {
    if (!bytes) return;
    const blob = new Blob([bytes as any]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async (): Promise<void> => {
    if (!filePid || !folderKeyHex || !session) return;
    try {
      const folderPid = getFolderPid(fromHex(folderKeyHex));
      await fetch(mediaUrl(folderPid, filePid, 'dat'), { method: 'DELETE' });
      await fetch(mediaUrl(folderPid, filePid, 'thumb'), { method: 'DELETE' });
      router.replace(`/folder?folder=${encodeURIComponent(folder)}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!session) return <></>;

  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';

  return (
    <AppShell username={session.username} activeFolder={folder} showSidebar>
      <div className="mh-viewer">
        <div className="mh-viewer__bar">
          <Link href={`/folder?folder=${encodeURIComponent(folder)}`} aria-label="Back to folder">
            <md-icon-button aria-label="Back">
              <Icon symbol="arrow_back" ariaLabel="" />
            </md-icon-button>
          </Link>
          <h1 className="mh-viewer__title">{fileName}</h1>
          <md-icon-button onClick={handleDownload} disabled={!bytes} aria-label="Download">
            <Icon symbol="download" ariaLabel="" />
          </md-icon-button>
          <md-icon-button onClick={() => setDelOpen(true)} aria-label="Delete">
            <Icon symbol="delete" ariaLabel="" />
          </md-icon-button>
        </div>

        <div className="mh-viewer__stage">
          {!bytes && !error && (
            <div style={{ color: 'var(--md-sys-color-on-surface-variant)' }}>
              <md-circular-progress indeterminate />
            </div>
          )}
          {error && (
            <div style={{ color: 'var(--md-sys-color-error)' }}>{error}</div>
          )}
          {objectUrl && ext.match(/^(jpg|jpeg|png|gif|webp|bmp)$/) && (
            <img src={objectUrl} alt={fileName} className="mh-viewer__content" />
          )}
          {objectUrl && ext === 'pdf' && (
            <iframe src={objectUrl} title={fileName} className="mh-viewer__content" style={{ width: '90vw', height: '75vh' }} />
          )}
          {objectUrl && ext.match(/^(mp4|webm)$/) && (
            <video src={objectUrl} controls className="mh-viewer__content" />
          )}
          {!objectUrl && textPreview && (
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