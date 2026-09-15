'use client';

import * as React from 'react';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.JSX.Element {
  const dialogRef = React.useRef<HTMLDialogElement & MdDialogElement>(null);

  React.useEffect(() => {
    const el = dialogRef.current as (HTMLDialogElement & MdDialogElement) | null;
    if (!el) return;
    if (open) el.show();
    else el.close();
  }, [open]);

  return (
    <md-dialog ref={dialogRef} onClose={() => onCancel()}>
      <div slot="headline">{title}</div>
      <div slot="content" style={{ whiteSpace: 'pre-wrap', maxWidth: 480 }}>
        {message}
      </div>
      <div slot="actions">
        <md-text-button onClick={() => onCancel()}>{cancelLabel}</md-text-button>
        {destructive ? (
          <md-filled-button onClick={() => onConfirm()}>{confirmLabel}</md-filled-button>
        ) : (
          <md-filled-button onClick={() => onConfirm()}>{confirmLabel}</md-filled-button>
        )}
      </div>
    </md-dialog>
  );
}