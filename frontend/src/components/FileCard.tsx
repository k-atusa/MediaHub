'use client';

import * as React from 'react';
import Link from 'next/link';
import { Icon } from './Icon';
import type { FileEntry, FileKind } from '@/types/mediahub';

export type FileCardAction = 'rename' | 'share' | 'download' | 'delete';

export interface FileCardProps {
  file: FileEntry;
  folderName: string;
  onAction: (action: FileCardAction, file: FileEntry) => void;
}

const KIND_ICONS: Record<FileKind, string> = {
  text: 'description',
  image: 'image',
  video: 'movie',
  pdf: 'picture_as_pdf',
  binary: 'draft',
};

export function FileCard({ file, folderName, onAction }: FileCardProps): React.JSX.Element {
  const menuId = React.useId();
  const buttonId = `${menuId}-btn`;
  const menuRef = React.useRef<MdMenuElement>(null);

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

  const viewerHref = `/viewer?folder=${encodeURIComponent(folderName)}&pid=${encodeURIComponent(file.pid)}&name=${encodeURIComponent(file.name)}`;

  return (
    <Link href={viewerHref} className="mh-file-card" aria-label={file.name}>
      <md-elevated-card class="mh-file-card__surface">
        <div className="mh-file-card__thumb">
          {file.thumb ? (
            <img src={file.thumb} alt="" loading="lazy" />
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
