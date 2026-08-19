'use client';

import * as React from 'react';
import { Icon } from './Icon';

export interface UploadFABProps {
  onPick: (files: FileList) => void;
  disabled?: boolean;
}

export function UploadFAB({ onPick, disabled }: UploadFABProps): JSX.Element {
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleClick = (): void => {
    inputRef.current?.click();
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    if (event.target.files && event.target.files.length > 0) {
      onPick(event.target.files);
      event.target.value = '';
    }
  };

  return (
    <div className="mh-fab-container">
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={handleChange}
        aria-hidden
        tabIndex={-1}
      />
      <md-fab
        variant="primary"
        label="Upload"
        disabled={disabled}
        onClick={handleClick}
      >
        <Icon symbol="upload" slot="icon" ariaLabel="" />
      </md-fab>
    </div>
  );
}