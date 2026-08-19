'use client';

import * as React from 'react';

export interface ProgressSnackbarProps {
  open: boolean;
  message: string;
  /** 0..1 */
  progress?: number;
  actionLabel?: string;
  onAction?: () => void;
  onClose?: () => void;
}

export function ProgressSnackbar({
  open,
  message,
  progress,
  actionLabel,
  onAction,
  onClose,
}: ProgressSnackbarProps): JSX.Element {
  if (!open) return <></>;

  return (
    <md-snackbar
      open={open}
      style={{ zIndex: 300 }}
      onClose={() => onClose?.()}
    >
      <div className="mh-snackbar__content">
        <div className="mh-snackbar__label">{message}</div>
        {typeof progress === 'number' && (
          <md-linear-progress
            value={Math.max(0, Math.min(1, progress)) * 100}
            style={{ width: '100%' }}
          />
        )}
      </div>
      {actionLabel && (
        <md-text-button onClick={() => onAction?.()}>{actionLabel}</md-text-button>
      )}
      {onClose && <md-icon-button slot="dismiss" aria-label="Dismiss" />}
    </md-snackbar>
  );
}