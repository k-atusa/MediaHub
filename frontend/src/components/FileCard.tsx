'use client';

import * as React from 'react';
import Link from 'next/link';
import { Icon } from './Icon';
import type { FileEntry, FileKind } from '@/types/mediahub';

import { decryptThumbBytes, fromHex } from '@/lib/crypto';
import { mediaUrl } from '@/lib/api';

export type FileCardAction = 'rename' | 'share' | 'download' | 'delete';

export interface FileCardProps {
  file: FileEntry;
  folderName: string;
  folderPid?: string;
  folderKeyHex?: string;
  onAction: (action: FileCardAction, file: FileEntry) => void;
}

const KIND_ICONS: Record<FileKind, string> = {
  text: 'description',
  image: 'image',
  video: 'movie',
  pdf: 'picture_as_pdf',
  binary: 'draft',
};

export function FileCard({ file, folderName, folderPid, folderKeyHex, onAction }: FileCardProps): React.JSX.Element {
  const menuId = React.useId();
  const buttonId = `${menuId}-btn`;
  const menuRef = React.useRef<MdMenuElement>(null);
  const [thumbUrl, setThumbUrl] = React.useState<string | null>(file.thumb || null);
  const activeUrlRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (file.thumb) {
      setThumbUrl(file.thumb);
      return;
    }
    if (!folderPid || !file.pid || !file.keyHex) return;
    let isSubscribed = true;

    (async () => {
      try {
        const resp = await fetch(mediaUrl(folderPid, file.pid, 'thumb'));
        if (resp.status === 404 || !resp.ok) return;
        const dat = new Uint8Array(await resp.arrayBuffer());
        const dec = await decryptThumbBytes(dat, fromHex(file.keyHex));
        if (!isSubscribed) return;
        const url = URL.createObjectURL(new Blob([dec as any], { type: 'image/jpeg' }));
        activeUrlRef.current = url;
        setThumbUrl(url);
      } catch (err) {
        console.warn(`[FileCard] Thumbnail error for "${file.name}":`, err);
      }
    })();

    return () => {
      isSubscribed = false;
    };
  }, [folderPid, file.pid, file.keyHex, file.thumb]);

  // Revoke object URL ONLY when unmounting
  React.useEffect(() => {
    return () => {
      if (activeUrlRef.current) {
        URL.revokeObjectURL(activeUrlRef.current);
        activeUrlRef.current = null;
      }
    };
  }, []);

  const handleMoreClick = (event: React.MouseEvent<HTMLElement>): void => {
    event.stopPropagation();
    event.preventDefault();
    menuRef.current?.show();
  };

  const handleAction = (action: FileCardAction) => (event: React.MouseEvent<HTMLElement>): void => {
    event.stopPropagation();
    event.preventDefault();
    menuRef.current?.close();
    onAction(action, file);
  };

  const handleCardClick = (): void => {
    if (typeof window !== 'undefined') {
      if (folderPid) sessionStorage.setItem('currentFolderId', folderPid);
      if (folderKeyHex) sessionStorage.setItem('currentFolderKey', folderKeyHex);
      sessionStorage.setItem('currentFilePid', file.pid);
      sessionStorage.setItem('currentFileKey', file.keyHex);
      sessionStorage.setItem('currentFileName', file.name);
      sessionStorage.setItem('currentFolderName', folderName);
    }
  };

  const keyParam = file.keyHex ? `&key=${encodeURIComponent(file.keyHex)}` : '';
  const fkParam = folderKeyHex ? `&fk=${encodeURIComponent(folderKeyHex)}` : '';
  const viewerHref = `/viewer?folder=${encodeURIComponent(folderName)}&pid=${encodeURIComponent(file.pid)}&name=${encodeURIComponent(file.name)}${keyParam}${fkParam}`;

  return (
    <Link href={viewerHref} className="mh-file-card" aria-label={file.name} onClick={handleCardClick}>
      <md-elevated-card class="mh-file-card__surface">
        <div className="mh-file-card__thumb">
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt={file.name}
              onError={() => {
                console.warn(`[FileCard] Image failed to render for "${file.name}"`);
                setThumbUrl(null);
              }}
            />
          ) : (
            <Icon symbol={KIND_ICONS[file.kind]} className="mh-file-card__icon" filled ariaLabel="" />
          )}
          <div className="mh-file-card__actions">
            <md-icon-button
              id={buttonId}
              aria-label={`More actions for ${file.name}`}
              aria-haspopup="menu"
              aria-controls={menuId}
              onClick={handleMoreClick}
            >
              <Icon symbol="more_vert" ariaLabel="" />
            </md-icon-button>
            <md-menu
              ref={menuRef}
              id={menuId}
              anchor={buttonId}
              positioning="fixed"
              aria-label="File actions"
            >
              <md-menu-item onClick={handleAction('rename')}>
                <Icon symbol="drive_file_rename_outline" slot="start" ariaLabel="" />
                <div slot="headline">Rename</div>
              </md-menu-item>
              <md-menu-item onClick={handleAction('share')}>
                <Icon symbol="share" slot="start" ariaLabel="" />
                <div slot="headline">Share</div>
              </md-menu-item>
              <md-menu-item onClick={handleAction('download')}>
                <Icon symbol="download" slot="start" ariaLabel="" />
                <div slot="headline">Download</div>
              </md-menu-item>
              <md-menu-item onClick={handleAction('delete')}>
                <Icon symbol="delete" slot="start" ariaLabel="" />
                <div slot="headline">Delete</div>
              </md-menu-item>
            </md-menu>
          </div>
        </div>
        <div className="mh-file-card__footer">
          <Icon symbol={KIND_ICONS[file.kind]} className="mh-file-card__name-icon" ariaLabel="" />
          <span className="mh-file-card__name" title={file.name}>
            {file.name}
          </span>
        </div>
      </md-elevated-card>
    </Link>
  );
}
