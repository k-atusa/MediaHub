'use client';

import * as React from 'react';
import { Icon } from './Icon';

export interface BrandMarkProps {
  size?: 'small' | 'medium' | 'large';
  showText?: boolean;
}

export function BrandMark({ size = 'medium', showText = true }: BrandMarkProps): React.JSX.Element {
  const iconSize = size === 'small' ? 24 : size === 'large' ? 40 : 32;
  const fontSize = size === 'small' ? 18 : size === 'large' ? 28 : 22;

  return (
    <div
      className="mh-brand"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        color: 'var(--md-sys-color-on-surface)',
      }}
      aria-label="MediaHub home"
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: iconSize,
          height: iconSize,
          borderRadius: 'var(--mh-radius-md)',
          background: 'var(--md-sys-color-primary-container)',
          color: 'var(--md-sys-color-on-primary-container)',
        }}
      >
        <Icon symbol="cloud" filled size={iconSize - 8} ariaLabel="MediaHub logo" />
      </div>
      {showText && (
        <span
          style={{
            fontSize,
            fontWeight: 500,
            letterSpacing: '-0.02em',
            whiteSpace: 'nowrap',
          }}
        >
          MediaHub
        </span>
      )}
    </div>
  );
}
