'use client';

import * as React from 'react';
import { Icon } from './Icon';

export interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon = 'cloud_off',
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div className="mh-empty">
      <Icon symbol={icon} className="mh-empty__icon" ariaLabel="" />
      <h2 className="mh-empty__title">{title}</h2>
      {description && <p className="mh-empty__text">{description}</p>}
      {actionLabel && onAction && (
        <md-filled-button onClick={onAction}>
          <Icon symbol="add" slot="icon" ariaLabel="" />
          {actionLabel}
        </md-filled-button>
      )}
    </div>
  );
}