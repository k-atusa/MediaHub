'use client';

import * as React from 'react';
import { Icon } from './Icon';
import { BrandMark } from './BrandMark';
import type { ThemeMode } from '@/styles/theme';

export interface TopBarProps {
  onMenuClick?: () => void;
  onSearch?: (query: string) => void;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
  username?: string;
}

export function TopBar({ onMenuClick, onSearch, themeMode, onToggleTheme, username }: TopBarProps): React.JSX.Element {
  const searchRef = React.useRef<MdOutlinedTextFieldElement>(null);

  const handleSearch = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const query = searchRef.current?.value ?? '';
    onSearch?.(query);
  };

  return (
    <header className="mh-topbar" role="banner">
      <md-icon-button
        class="mh-topbar__menu"
        aria-label="Open navigation drawer"
        onClick={onMenuClick}
      >
        <Icon symbol="menu" ariaLabel="" />
      </md-icon-button>

      <div className="mh-topbar__brand">
        <BrandMark size="small" />
      </div>

      <form className="mh-topbar__search" onSubmit={handleSearch} role="search">
        <md-outlined-text-field
          ref={searchRef}
          type="search"
          placeholder="Search in MediaHub"
          aria-label="Search files"
          style={{ width: '100%' }}
        >
          <md-icon-button slot="trailing-icon" type="submit" aria-label="Submit search">
            <Icon symbol="search" ariaLabel="" />
          </md-icon-button>
        </md-outlined-text-field>
      </form>

      <div className="mh-topbar__actions">
        <md-icon-button
          aria-label={themeMode === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
          onClick={onToggleTheme}
        >
          <Icon symbol={themeMode === 'light' ? 'dark_mode' : 'light_mode'} ariaLabel="" />
        </md-icon-button>

        <md-icon-button aria-label="Help">
          <Icon symbol="help" ariaLabel="" />
        </md-icon-button>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--mh-space-2)',
            marginLeft: 'var(--mh-space-1)',
          }}
        >
          <span className="mh-avatar" aria-label={`Signed in as ${username ?? 'Guest'}`}>
            {username ? username.slice(0, 2).toUpperCase() : '??'}
          </span>
        </div>
      </div>
    </header>
  );
}
