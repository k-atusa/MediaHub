'use client';

import * as React from 'react';
import { FileCard, type FileCardAction } from './FileCard';
import type { FileEntry } from '@/types/mediahub';

export interface FileGridProps {
  files: FileEntry[];
  folderName: string;
  folderPid?: string;
  folderKeyHex?: string;
  onAction: (action: FileCardAction, file: FileEntry) => void;
}

export function FileGrid({ files, folderName, folderPid, folderKeyHex, onAction }: FileGridProps): React.JSX.Element {
  return (
    <div className="mh-file-grid" role="list">
      {files.map((file) => (
        <FileCard
          key={file.pid}
          file={file}
          folderName={folderName}
          folderPid={folderPid}
          folderKeyHex={folderKeyHex}
          onAction={onAction}
        />
      ))}
    </div>
  );
}
