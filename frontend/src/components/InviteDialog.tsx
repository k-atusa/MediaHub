'use client';

import * as React from 'react';

export interface InviteDialogProps {
  open: boolean;
  onConfirm: (code: string) => void;
  onCancel: () => void;
}

export function InviteDialog({ open, onConfirm, onCancel }: InviteDialogProps): React.JSX.Element {
  const dialogRef = React.useRef<HTMLDialogElement & MdDialogElement>(null);
  const inputRef = React.useRef<HTMLInputElement & { value: string }>(null);

  React.useEffect(() => {
    const el = dialogRef.current as (HTMLDialogElement & MdDialogElement) | null;
    if (!el) return;
    if (open) el.show();
    else el.close();
  }, [open]);

  const handleConfirm = (): void => {
    const code = inputRef.current?.value ?? '';
    onConfirm(code.trim());
  };

  return (
    <md-dialog ref={dialogRef} onClose={() => onCancel()}>
      <div slot="headline">🔑 Invite code required</div>
      <div slot="content" style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 320 }}>
        <p style={{ margin: 0, color: 'var(--md-sys-color-on-surface-variant)' }}>
          Enter the invite code shared with you to register an account.
        </p>
        <md-outlined-text-field
          ref={inputRef}
          label="Invite code"
          autofocus
          style={{ width: '100%' }}
        />
      </div>
      <div slot="actions">
        <md-text-button onClick={() => onCancel()}>Cancel</md-text-button>
        <md-filled-button onClick={handleConfirm}>Confirm</md-filled-button>
      </div>
    </md-dialog>
  );
}