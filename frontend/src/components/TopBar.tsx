'use client';

import * as React from 'react';
import { Icon } from './Icon';
import { BrandMark } from './BrandMark';
import type { ThemePreference, ResolvedTheme, ThemeMode } from '@/styles/theme';

export interface TopBarProps {
  onMenuClick?: () => void;
  searchQuery?: string;
  onSearch?: (query: string) => void;
  themePreference?: ThemePreference;
  resolvedTheme?: ResolvedTheme;
  themeMode?: ThemeMode;
  onToggleTheme: () => void;
  username?: string;
  onLogout?: () => void;
}

export function TopBar({
  onMenuClick,
  searchQuery = '',
  onSearch,
  themePreference = 'auto',
  resolvedTheme = 'light',
  themeMode,
  onToggleTheme,
  username,
  onLogout,
}: TopBarProps): React.JSX.Element {
  const searchRef = React.useRef<MdOutlinedTextFieldElement>(null);
  const [value, setValue] = React.useState(searchQuery);

  React.useEffect(() => {
    setValue(searchQuery);
    if (searchRef.current && searchRef.current.value !== searchQuery) {
      searchRef.current.value = searchQuery;
    }
  }, [searchQuery]);

  const handleInput = (event: any): void => {
    const next = event.target?.value ?? '';
    setValue(next);
    onSearch?.(next);
  };

  const handleClear = (): void => {
    setValue('');
    if (searchRef.current) {
      searchRef.current.value = '';
      searchRef.current.focus();
    }
    onSearch?.('');
  };

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape' && value) {
      event.preventDefault();
      handleClear();
    }
  };

  const handleSearch = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const query = searchRef.current?.value ?? value;
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
          type="text"
          placeholder="Search in MediaHub"
          aria-label="Search files"
          value={value}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          style={{ width: '100%' }}
        >
          <Icon symbol="search" slot="leading-icon" size={20} ariaLabel="" />
          {value ? (
            <md-icon-button
              slot="trailing-icon"
              type="button"
              aria-label="Clear search"
              onClick={handleClear}
              style={{
                width: 28,
                height: 28,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon symbol="close" size={18} ariaLabel="" />
            </md-icon-button>
          ) : null}
        </md-outlined-text-field>
      </form>

      <div className="mh-topbar__actions">
        <md-icon-button
          id="mh-theme-toggle-btn"
          aria-label={
            themePreference === 'auto'
              ? `Theme: Auto (${resolvedTheme === 'dark' ? 'Dark' : 'Light'}) - Click to switch to Light`
              : themePreference === 'light'
              ? 'Theme: Light - Click to switch to Dark'
              : 'Theme: Dark - Click to switch to Auto (System)'
          }
          title={
            themePreference === 'auto'
              ? `Theme: Auto (${resolvedTheme === 'dark' ? 'Dark' : 'Light'})`
              : themePreference === 'light'
              ? 'Theme: Light'
              : 'Theme: Dark'
          }
          onClick={onToggleTheme}
        >
          <Icon
            symbol={
              themePreference === 'auto'
                ? 'brightness_auto'
                : themePreference === 'light'
                ? 'light_mode'
                : 'dark_mode'
            }
            ariaLabel=""
          />
        </md-icon-button>

        <md-icon-button aria-label="Help">
          <Icon symbol="help" ariaLabel="" />
        </md-icon-button>

        {onLogout && (
          <md-icon-button aria-label="Sign out" title="Sign out" onClick={onLogout}>
            <Icon symbol="logout" ariaLabel="" />
          </md-icon-button>
        )}

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
