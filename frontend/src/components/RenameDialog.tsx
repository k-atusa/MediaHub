'use client';

import * as React from 'react';

export interface RenameDialogProps {
  open: boolean;
  initialName: string;
  onConfirm: (next: string) => void;
  onCancel: () => void;
}

export function RenameDialog({ open, initialName, onConfirm, onCancel }: RenameDialogProps): React.JSX.Element {
  const dialogRef = React.useRef<HTMLDialogElement & MdDialogElement>(null);
  const inputRef = React.useRef<HTMLInputElement & { value: string }>(null);

  React.useEffect(() => {
    const el = dialogRef.current as (HTMLDialogElement & MdDialogElement) | null;
    if (!el) return;
    if (open) {
      // Pre-fill the input
      if (inputRef.current) inputRef.current.value = initialName;
      el.show();
    } else {
      el.close();
    }
  }, [open, initialName]);

  const handleConfirm = (): void => {
    const value = inputRef.current?.value?.trim() ?? '';
    onConfirm(value);
  };

  return (
    <md-dialog ref={dialogRef} onClose={() => onCancel()}>
      <div slot="headline">Rename</div>
      <div slot="content" style={{ minWidth: 320 }}>
        <md-outlined-text-field
          ref={inputRef}
          label="File name"
          autofocus
          style={{ width: '100%' }}
        />
      </div>
      <div slot="actions">
        <md-text-button onClick={() => onCancel()}>Cancel</md-text-button>
        <md-filled-button onClick={handleConfirm}>Save</md-filled-button>
      </div>
    </md-dialog>
  );
}