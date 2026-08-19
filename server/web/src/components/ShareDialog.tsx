'use client';

import * as React from 'react';

export interface ShareDialogProps {
  open: boolean;
  mode: 'export' | 'import';
  initialToken?: string;
  onExportConfirm: (password: string) => Promise<string | null>;
  onImportConfirm: (token: string, password: string) => Promise<{ name: string; pid: string } | null>;
  onClose: () => void;
}

export function ShareDialog({
  open,
  mode,
  initialToken,
  onExportConfirm,
  onImportConfirm,
  onClose,
}: ShareDialogProps): JSX.Element {
  const dialogRef = React.useRef<HTMLDialogElement & MdDialogElement>(null);
  const tokenRef = React.useRef<HTMLInputElement & { value: string }>(null);
  const pwRef = React.useRef<HTMLInputElement & { value: string }>(null);
  const [result, setResult] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const el = dialogRef.current as (HTMLDialogElement & MdDialogElement) | null;
    if (!el) return;
    if (open) {
      setResult(null);
      if (initialToken && tokenRef.current) tokenRef.current.value = initialToken;
      el.show();
    } else {
      el.close();
    }
  }, [open, initialToken]);

  const handleConfirm = async (): Promise<void> => {
    setBusy(true);
    try {
      const pw = pwRef.current?.value ?? '';
      if (mode === 'export') {
        const tok = await onExportConfirm(pw);
        if (tok) setResult(tok);
      } else {
        const tk = tokenRef.current?.value ?? '';
        const r = await onImportConfirm(tk, pw);
        if (r) {
          alert(`Imported "${r.name}".`);
          onClose();
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const downloadToken = (): void => {
    if (!result) return;
    const blob = new Blob([result], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mediahub_share.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <md-dialog ref={dialogRef} onClose={() => onClose()}>
      <div slot="headline">
        {mode === 'export' ? '📤 Export share token' : '📥 Import share token'}
      </div>
      <div slot="content" style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 360 }}>
        {mode === 'import' && (
          <md-outlined-text-field
            ref={tokenRef}
            label="Share token"
            type="textarea"
            rows={4}
            style={{ width: '100%' }}
          />
        )}
        <md-outlined-text-field
          ref={pwRef}
          type="password"
          label="Share password"
          style={{ width: '100%' }}
        />
        {result && mode === 'export' && (
          <>
            <p style={{ margin: 0, color: 'var(--md-sys-color-on-surface-variant)' }}>
              Token generated. Save it securely — the share password is not stored anywhere.
            </p>
            <textarea
              readOnly
              value={result}
              rows={4}
              style={{
                width: '100%',
                fontFamily: 'monospace',
                fontSize: 12,
                padding: 8,
                border: '1px solid var(--md-sys-color-outline-variant)',
                borderRadius: 8,
                background: 'var(--md-sys-color-surface-container-lowest)',
                color: 'var(--md-sys-color-on-surface)',
              }}
            />
          </>
        )}
      </div>
      <div slot="actions">
        <md-text-button onClick={() => onClose()}>Close</md-text-button>
        {mode === 'export' && result ? (
          <md-filled-button onClick={downloadToken}>Download</md-filled-button>
        ) : (
          <md-filled-button disabled={busy} onClick={handleConfirm}>
            {busy ? 'Working…' : mode === 'export' ? 'Generate' : 'Import'}
          </md-filled-button>
        )}
      </div>
    </md-dialog>
  );
}