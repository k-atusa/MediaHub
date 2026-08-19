'use client';

import * as React from 'react';
import { FileCard, type FileCardAction } from './FileCard';
import type { FileEntry } from '@/types/mediahub';

export interface FileGridProps {
  files: FileEntry[];
  folderName: string;
  onAction: (action: FileCardAction, file: FileEntry) => void;
}

export function FileGrid({ files, folderName, onAction }: FileGridProps): JSX.Element {
  return (
    <div className="mh-file-grid" role="list">
      {files.map((file) => (
        <FileCard key={file.pid} file={file} folderName={folderName} onAction={onAction} />
      ))}
    </div>
  );
}
