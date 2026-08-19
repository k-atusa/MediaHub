'use client';

import * as React from 'react';

export interface ChangePasswordDialogProps {
  open: boolean;
  onConfirm: (newPassword: string) => void;
  onCancel: () => void;
}

export function ChangePasswordDialog({ open, onConfirm, onCancel }: ChangePasswordDialogProps): JSX.Element {
  const dialogRef = React.useRef<HTMLDialogElement & MdDialogElement>(null);
  const pw1Ref = React.useRef<HTMLInputElement & { value: string }>(null);
  const pw2Ref = React.useRef<HTMLInputElement & { value: string }>(null);

  React.useEffect(() => {
    const el = dialogRef.current as (HTMLDialogElement & MdDialogElement) | null;
    if (!el) return;
    if (open) el.show();
    else el.close();
  }, [open]);

  const handleConfirm = (): void => {
    const pw1 = pw1Ref.current?.value ?? '';
    const pw2 = pw2Ref.current?.value ?? '';
    if (!pw1 || pw1 !== pw2) {
      alert('Passwords do not match');
      return;
    }
    onConfirm(pw1);
  };

  return (
    <md-dialog ref={dialogRef} onClose={() => onCancel()}>
      <div slot="headline">🔑 Change password</div>
      <div slot="content" style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 320 }}>
        <md-outlined-text-field
          ref={pw1Ref}
          type="password"
          label="New password"
          autofocus
          style={{ width: '100%' }}
        />
        <md-outlined-text-field
          ref={pw2Ref}
          type="password"
          label="Confirm password"
          style={{ width: '100%' }}
        />
      </div>
      <div slot="actions">
        <md-text-button onClick={() => onCancel()}>Cancel</md-text-button>
        <md-filled-button onClick={handleConfirm}>Change</md-filled-button>
      </div>
    </md-dialog>
  );
}