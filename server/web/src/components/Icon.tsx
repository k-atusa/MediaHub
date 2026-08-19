'use client';

import * as React from 'react';

export interface IconProps {
  symbol: string;
  className?: string;
  filled?: boolean;
  size?: number;
  ariaLabel?: string;
}

export function Icon({ symbol, className = '', filled = false, size, ariaLabel }: IconProps): JSX.Element {
  const style: React.CSSProperties = {};
  if (size) {
    style.fontSize = `${size}px`;
  }
  if (filled) {
    style.fontVariationSettings = "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24";
  }

  return (
    <span
      className={`material-symbols-rounded ${className}`}
      style={style}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      role={ariaLabel ? 'img' : undefined}
    >
      {symbol}
    </span>
  );
}
