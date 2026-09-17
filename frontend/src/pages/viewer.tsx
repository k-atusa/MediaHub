'use client';

import * as React from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ClientOnly } from '@/components/ClientOnly';
import { AppShell } from '@/components/AppShell';
import { Icon } from '@/components/Icon';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useSessionContext } from '@/context/SessionContext';
import {
  mask,
  fromHex,
  toHex,
  wipe,
  NetSrc,
  SymMaster,
  DecodeInt,
  EncodeCfg,
  DecodeCfg,
} from '@/lib/crypto';
import { mediaUrl, folderNamesUrl } from '@/lib/api';
import { unregisterVideoStream } from '@/lib/videoStream';

// Option: Disable ServiceWorker for WebKit (Safari), matching commit 92ac2ec4
const OPT_NOSW_WEBKIT = true;

function getKind(name: string): 'video' | 'image' | 'pdf' | 'text' {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['mp4', 'webm', 'mov', 'mkv', 'm4v', 'ogv'].includes(ext)) return 'video';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return 'text';
}

function getMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const mimeMap: Record<string, string> = {
    pdf: 'application/pdf',
    txt: 'text/plain',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

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

  const [flName, setFlName] = React.useState<string>('');
  const [fldName, setFldName] = React.useState<string>('');
  const [flPid, setFlPid] = React.useState<string>('');
  const [fldId, setFldId] = React.useState<string>('');
  const [statusMessage, setStatusMessage] = React.useState<string | null>('Preparing stream…');
  const [downloadProgress, setDownloadProgress] = React.useState<number | null>(null);

  // In-memory masked keys & metadata refs so they are masked and wiped on unmount
  const maskedFldKeyRef = React.useRef<Uint8Array | null>(null);
  const maskedFlKeyRef = React.useRef<Uint8Array | null>(null);
  const origSizeRef = React.useRef<number>(0);
  const rawBufRef = React.useRef<Uint8Array | null>(null);

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

  // Load and mask keys strictly from session storage upon mount (with backward query-param fallback)
  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    let rawFKHex = sessionStorage.getItem('currentFolderKey');
    let rawFlKHex = sessionStorage.getItem('currentFileKey');
    let sFldId = sessionStorage.getItem('currentFolderId') || '';
    let sFlName = sessionStorage.getItem('currentFileName') || (query.name as string) || '';
    let sFldName = sessionStorage.getItem('currentFolderName') || (query.folder as string) || '';
    let sFlPid = sessionStorage.getItem('currentFilePid') || (query.pid as string) || '';

    // If query has keys, adopt and clean URL to prevent key leakage in browser history/logs
    if (!rawFlKHex && query.key) {
      rawFlKHex = query.key as string;
    }
    if (!rawFKHex && query.fk) {
      rawFKHex = query.fk as string;
    }
    if (query.key || query.fk) {
      router.replace(
        `/viewer?folder=${encodeURIComponent(sFldName)}&name=${encodeURIComponent(sFlName)}`,
        undefined,
        { shallow: true }
      );
    }

    if (rawFKHex) {
      const rawFK = fromHex(rawFKHex);
      maskedFldKeyRef.current = mask.XOR(rawFK);
      if (!sFldId && rawFK.length >= 44) sFldId = toHex(rawFK.slice(32, 44));
      rawFK.fill(0);
    }

    if (rawFlKHex) {
      const rawFlK = fromHex(rawFlKHex);
      if (rawFlK.length >= 52) {
        origSizeRef.current = DecodeInt(rawFlK.slice(44, 52));
      } else {
        origSizeRef.current = 0;
      }
      const keyPrt = rawFlK.slice(0, 44);
      maskedFlKeyRef.current = mask.XOR(keyPrt);
      if (!sFlPid && keyPrt.length >= 44) sFlPid = toHex(keyPrt.slice(32, 44));
      keyPrt.fill(0);
      rawFlK.fill(0);
    }

    setFlName(sFlName);
    setFldName(sFldName);
    setFlPid(sFlPid);
    setFldId(sFldId);

    return () => {
      // Wipe keys on unmount
      if (maskedFldKeyRef.current) {
        maskedFldKeyRef.current.fill(0);
        maskedFldKeyRef.current = null;
      }
      if (maskedFlKeyRef.current) {
        maskedFlKeyRef.current.fill(0);
        maskedFlKeyRef.current = null;
      }
      if (rawBufRef.current) {
        rawBufRef.current.fill(0);
        rawBufRef.current = null;
      }
    };
  }, [router, query]);

  // Main playback & decryption lifecycle matching commit 92ac2ec4
  React.useEffect(() => {
    if (!fldId || !flPid || !maskedFlKeyRef.current || !flName) return;
    let cancelled = false;

    const kind = getKind(flName);

    // Client-side fallback download & browser decryption (never sends keys to backend)
    const fullDown = async () => {
      setStatusMessage('📥 Downloading encrypted media…');
      try {
        const head = await fetch(`/api/media/${fldId}/${flPid}/dat`, {
          headers: { Range: 'bytes=0-0' },
        });
        if (!head.ok) throw new Error(`Media fetch failed (${head.status})`);
        const cr = head.headers.get('Content-Range');
        const totSize = cr
          ? parseInt(cr.split('/')[1], 10)
          : parseInt(head.headers.get('Content-Length') || '0', 10);
        if (!totSize) throw new Error('Could not determine media size');

        let loaded = 0;
        const chunks: Uint8Array[] = [];

        while (loaded < totSize) {
          if (cancelled) return;
          try {
            const res = await fetch(`/api/media/${fldId}/${flPid}/dat`, {
              headers: { Range: `bytes=${loaded}-${totSize - 1}` },
            });
            const reader = res.body?.getReader();
            if (!reader) throw new Error('No stream body');
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
              loaded += value.length;
              if (!cancelled) setDownloadProgress(Math.round((loaded / totSize) * 100));
            }
          } catch (e) {
            await new Promise((r) => setTimeout(r, 1000));
          }
        }

        if (cancelled) return;
        setStatusMessage('🔒 Decrypting media…');
        const fullBuf = new Uint8Array(loaded);
        let offset = 0;
        for (const c of chunks) {
          fullBuf.set(c, offset);
          offset += c.length;
        }

        if (!maskedFlKeyRef.current) return;
        const rawFK = mask.XOR(maskedFlKeyRef.current);
        const smx = new SymMaster('gcmx1', rawFK.slice(0, 32)) as any;
        rawFK.fill(0);

        let ciphSize = fullBuf.length;
        if (typeof smx.AfterSize === 'function' && origSizeRef.current > 0) {
          ciphSize = smx.AfterSize(origSizeRef.current);
        }
        const encBuf = fullBuf.slice(0, ciphSize);
        fullBuf.fill(0);

        const plnChks: Uint8Array[] = [];
        await smx.DeFile(new NetSrc(encBuf), encBuf.length, {
          write: async (c: Uint8Array) => {
            plnChks.push(c);
          },
        });
        encBuf.fill(0);

        const decBuf = new Uint8Array(plnChks.reduce((a, c) => a + c.length, 0));
        let fo = 0;
        for (const c of plnChks) {
          decBuf.set(c, fo);
          fo += c.length;
        }

        if (cancelled) {
          decBuf.fill(0);
          return;
        }

        rawBufRef.current = decBuf;
        setBytes(decBuf);

        const mime = getMime(flName);
        if (kind === 'text') {
          setTextPreview(new TextDecoder().decode(decBuf));
        } else {
          const blob = new Blob([decBuf as any], { type: mime });
          const url = URL.createObjectURL(blob);
          setObjectUrl(url);
        }
        setStatusMessage(null);
      } catch (err) {
        if (!cancelled) {
          console.error('[Viewer] Client-side download/decryption failed:', err);
          setError((err as Error).message);
          setStatusMessage(null);
        }
      }
    };

    (async () => {
      // 1. Video: Stream via Service Worker on-the-fly
      if (kind === 'video') {
        const isWebkit =
          typeof navigator !== 'undefined' &&
          /AppleWebKit/i.test(navigator.userAgent) &&
          (!/Chrome/i.test(navigator.userAgent) || /CriOS/i.test(navigator.userAgent));

        if (OPT_NOSW_WEBKIT && isWebkit) {
          console.info('WebKit detected. Fallback to client-side full download.');
          await fullDown();
          return;
        }

        setStatusMessage('Preparing on-the-fly stream…');
        try {
          if (!('serviceWorker' in navigator)) {
            throw new Error('Service Worker not supported');
          }

          const reg = await navigator.serviceWorker.register('/sw.js');
          await navigator.serviceWorker.ready;

          if (!maskedFlKeyRef.current) return;
          const rawKey = mask.XOR(maskedFlKeyRef.current);
          const keyHex = toHex(rawKey);
          rawKey.fill(0);

          // Wait for SW ready ACK
          const ack = new Promise<void>((resolve) => {
            const h = (e: MessageEvent) => {
              if (e.data?.action === 'REGISTERED' && e.data.filePid === flPid) {
                navigator.serviceWorker.removeEventListener('message', h);
                resolve();
              }
            };
            navigator.serviceWorker.addEventListener('message', h);
            setTimeout(resolve, 1500);
          });

          // Handle SW key request if worker restarted
          const handleReqKey = (e: MessageEvent) => {
            if (e.data?.action === 'REQUEST_KEY' && e.data.filePid === flPid && maskedFlKeyRef.current) {
              const rk = mask.XOR(maskedFlKeyRef.current);
              const target = reg.active || navigator.serviceWorker.controller;
              if (target) {
                target.postMessage({
                  action: 'REGISTER',
                  folderId: fldId,
                  filePid: flPid,
                  fileKey: toHex(rk),
                  originalSize: origSizeRef.current,
                  fileName: flName,
                });
              }
              rk.fill(0);
            }
          };
          navigator.serviceWorker.addEventListener('message', handleReqKey);

          const targetSw = reg.active || navigator.serviceWorker.controller || reg.waiting || reg.installing;
          if (!targetSw) throw new Error('Service Worker could not be activated');

          targetSw.postMessage({
            action: 'REGISTER',
            folderId: fldId,
            filePid: flPid,
            fileKey: keyHex,
            originalSize: origSizeRef.current,
            fileName: flName,
          });

          await ack;

          if (!cancelled) {
            setStreamUrl(`/sw-stream/${encodeURIComponent(fldId)}/${encodeURIComponent(flPid)}`);
            setStatusMessage(null);
          }
        } catch (swErr) {
          console.warn('[Viewer] SW streaming unavailable, falling back to client-side in-browser decryption:', swErr);
          await fullDown();
        }
        return;
      }

      // 2. Non-video: Download and decrypt directly in browser
      await fullDown();
    })();

    return () => {
      cancelled = true;
      if (flPid) {
        unregisterVideoStream(flPid);
      }
    };
  }, [fldId, flPid, flName]);

  const handleDownload = async (): Promise<void> => {
    // If we already have the decrypted raw buffer:
    if (rawBufRef.current || bytes) {
      const buf = rawBufRef.current || bytes;
      if (!buf) return;
      const blob = new Blob([buf as any], { type: getMime(flName) });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = flName;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    // Video streaming mode: download and decrypt client-side on-demand for saving
    if (!fldId || !flPid || !maskedFlKeyRef.current) return;
    setDownloading(true);
    try {
      const head = await fetch(`/api/media/${fldId}/${flPid}/dat`, { headers: { Range: 'bytes=0-0' } });
      const totSize = parseInt(head.headers.get('Content-Range')?.split('/')[1] || '0', 10);
      let loaded = 0;
      const chunks: Uint8Array[] = [];
      while (loaded < totSize) {
        const res = await fetch(`/api/media/${fldId}/${flPid}/dat`, {
          headers: { Range: `bytes=${loaded}-${totSize - 1}` },
        });
        const reader = res.body?.getReader();
        if (!reader) break;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.length;
        }
      }
      const fullBuf = new Uint8Array(loaded);
      let offset = 0;
      for (const c of chunks) {
        fullBuf.set(c, offset);
        offset += c.length;
      }
      const rawFK = mask.XOR(maskedFlKeyRef.current);
      const smx = new SymMaster('gcmx1', rawFK.slice(0, 32)) as any;
      rawFK.fill(0);
      const ciphSize = smx.AfterSize(origSizeRef.current);
      const encBuf = fullBuf.slice(0, ciphSize);
      fullBuf.fill(0);

      const plnChks: Uint8Array[] = [];
      await smx.DeFile(new NetSrc(encBuf), encBuf.length, {
        write: async (c: Uint8Array) => {
          plnChks.push(c);
        },
      });
      encBuf.fill(0);
      const out = new Uint8Array(plnChks.reduce((a, c) => a + c.length, 0));
      let fo = 0;
      for (const c of plnChks) {
        out.set(c, fo);
        fo += c.length;
      }
      const blob = new Blob([out as any], { type: getMime(flName) });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = flName;
      a.click();
      URL.revokeObjectURL(url);
      out.fill(0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!flPid || !fldId || !session) return;
    try {
      if (maskedFldKeyRef.current) {
        try {
          const rawSK = mask.XOR(maskedFldKeyRef.current);
          const metaRes = await fetch(folderNamesUrl(fldId));
          if (metaRes.ok) {
            const sm = new SymMaster('gcm1', rawSK.slice(0, 32));
            const dec = await sm.DeBin(new Uint8Array(await metaRes.arrayBuffer()));
            const flsMap = DecodeCfg(dec) as Record<string, Uint8Array>;
            dec.fill(0);
            if (flsMap[flName]) {
              wipe(flsMap[flName]);
              delete flsMap[flName];
              const encoded = EncodeCfg(flsMap);
              for (const v of Object.values(flsMap)) wipe(v);
              await fetch(folderNamesUrl(fldId), {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream', 'X-User-Hash': session.userHash },
                body: (await sm.EnBin(encoded)) as any,
              });
              encoded.fill(0);
            }
          }
          rawSK.fill(0);
        } catch (err) {
          console.warn('Failed to update folder map after delete:', err);
        }
      }
      await fetch(mediaUrl(fldId, flPid, 'dat'), {
        method: 'DELETE',
        headers: { 'X-User-Hash': session.userHash },
      });
      await fetch(mediaUrl(fldId, flPid, 'thumb'), {
        method: 'DELETE',
        headers: { 'X-User-Hash': session.userHash },
      });
      router.replace(`/folder?folder=${encodeURIComponent(fldName)}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!session) return <></>;

  const isVideo = getKind(flName) === 'video';

  return (
    <AppShell
      username={session.username}
      activeFolder={fldName}
      showSidebar
      onSelectFolder={(nextFolderName) => router.push(`/folder?folder=${encodeURIComponent(nextFolderName)}`)}
      onLogout={() => {
        clearSession();
        router.replace('/');
      }}
    >
      <div className="mh-viewer">
        <div className="mh-viewer__bar">
          <Link href={`/folder?folder=${encodeURIComponent(fldName)}`} aria-label="Back to folder">
            <md-icon-button aria-label="Back">
              <Icon symbol="arrow_back" ariaLabel="" />
            </md-icon-button>
          </Link>
          <h1 className="mh-viewer__title">{flName}</h1>
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
            <div
              style={{
                color: 'var(--md-sys-color-on-surface-variant)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <md-circular-progress indeterminate />
              <span>{statusMessage || 'Loading…'}</span>
              {downloadProgress !== null && (
                <span style={{ fontSize: 13 }}>{downloadProgress}%</span>
              )}
            </div>
          )}
          {downloading && (
            <div
              style={{
                position: 'fixed',
                bottom: 24,
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'var(--md-sys-color-inverse-surface)',
                color: 'var(--md-sys-color-inverse-on-surface)',
                padding: '10px 20px',
                borderRadius: 8,
                zIndex: 1000,
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              }}
            >
              Preparing full download…
            </div>
          )}
          {error && (
            <div
              style={{
                color: 'var(--md-sys-color-error)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 16,
              }}
            >
              <span>{error}</span>
              <div style={{ display: 'flex', gap: 12 }}>
                <md-filled-button onClick={() => window.location.reload()}>
                  <Icon symbol="refresh" slot="icon" ariaLabel="" />
                  Retry
                </md-filled-button>
                <md-text-button onClick={handleDownload} disabled={downloading}>
                  <Icon symbol="download" slot="icon" ariaLabel="" />
                  Download
                </md-text-button>
              </div>
            </div>
          )}
          {streamUrl && isVideo && (
            <video
              src={streamUrl}
              controls
              playsInline
              autoPlay
              className="mh-viewer__content"
              style={{ maxHeight: '75vh', width: '100%', borderRadius: 'var(--mh-radius-md)' }}
              onError={(e) => {
                const target = e.currentTarget;
                const err = target.error;
                console.error('[Viewer] HTMLVideoElement playback error:', err);
                setError(
                  err?.message ||
                    'Video stream could not be played. Your browser may not support this video format/codec.'
                );
              }}
            />
          )}
          {objectUrl && isVideo && (
            <video
              src={objectUrl}
              controls
              playsInline
              autoPlay
              className="mh-viewer__content"
              style={{ maxHeight: '75vh', width: '100%', borderRadius: 'var(--mh-radius-md)' }}
            />
          )}
          {objectUrl && getKind(flName) === 'image' && (
            <img src={objectUrl} alt={flName} className="mh-viewer__content" />
          )}
          {objectUrl && getKind(flName) === 'pdf' && (
            <iframe
              src={objectUrl}
              title={flName}
              className="mh-viewer__content"
              style={{ width: '90vw', height: '75vh' }}
            />
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
        message={`Permanently delete "${flName}"?`}
        destructive
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDelOpen(false)}
      />
    </AppShell>
  );
}