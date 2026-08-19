'use client';

import * as React from 'react';
import { Icon } from './Icon';

export interface UploadDropZoneProps {
  onDrop: (files: FileList) => void;
  disabled?: boolean;
}

export function UploadDropZone({ onDrop, disabled }: UploadDropZoneProps): JSX.Element {
  const [active, setActive] = React.useState(false);
  const counter = React.useRef(0);

  React.useEffect(() => {
    if (disabled) return;
    const onDragEnter = (e: DragEvent): void => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault();
        counter.current += 1;
        setActive(true);
      }
    };
    const onDragOver = (e: DragEvent): void => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      }
    };
    const onDragLeave = (e: DragEvent): void => {
      e.preventDefault();
      counter.current = Math.max(0, counter.current - 1);
      if (counter.current === 0) setActive(false);
    };
    const onDrop = (e: DragEvent): void => {
      e.preventDefault();
      counter.current = 0;
      setActive(false);
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        onDrop(e.dataTransfer.files);
      }
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [disabled, onDrop]);

  return (
    <div className={`mh-drop-zone__overlay ${active ? 'mh-drop-zone__overlay--active' : ''}`} aria-hidden={!active}>
      <div className="mh-drop-zone__card">
        <Icon symbol="cloud_upload" className="mh-drop-zone__icon" ariaLabel="" />
        <h2 className="mh-drop-zone__title">Drop files to upload</h2>
        <p style={{ margin: 0, color: 'var(--md-sys-color-on-surface-variant)' }}>
          Release to encrypt and store them in this folder.
        </p>
      </div>
    </div>
  );
}