'use client';

import * as React from 'react';

export interface NoticeDialogProps {
  open: boolean;
  message: string;
  onClose: () => void;
}

export function NoticeDialog({ open, message, onClose }: NoticeDialogProps): JSX.Element {
  const dialogRef = React.useRef<HTMLDialogElement & MdDialogElement>(null);

  React.useEffect(() => {
    const el = dialogRef.current as (HTMLDialogElement & MdDialogElement) | null;
    if (!el) return;
    if (open) el.show();
    else el.close();
  }, [open]);

  return (
    <md-dialog ref={dialogRef} onClose={() => onClose()}>
      <div slot="headline">📢 Notice</div>
      <div slot="content" style={{ whiteSpace: 'pre-wrap', maxWidth: 480 }}>
        {message}
      </div>
      <div slot="actions">
        <md-text-button onClick={() => onClose()}>Got it</md-text-button>
      </div>
    </md-dialog>
  );
}