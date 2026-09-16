'use client';

import * as React from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Icon } from './Icon';
import { ClientOnly } from './ClientOnly';

import { useThemeContext } from '@/context/ThemeContext';

export interface AppShellProps {
  username?: string;
  activeFolder?: string;
  onCreateFolder?: () => void;
  searchQuery?: string;
  onSearch?: (query: string) => void;
  children: React.ReactNode;
  showSidebar?: boolean;
  onLogout?: () => void;
  folders?: string[];
  onSelectFolder?: (folder: string) => void;
}

export function AppShell({
  username,
  activeFolder,
  onCreateFolder,
  searchQuery,
  onSearch,
  children,
  showSidebar = true,
  onLogout,
  folders,
  onSelectFolder,
}: AppShellProps): React.JSX.Element {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const { preference, resolvedMode, cyclePreference } = useThemeContext();

  return (
    <div className="mh-page">
      <ClientOnly
        fallback={
          <div
            style={{
              minHeight: '100vh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--md-sys-color-surface)',
              color: 'var(--md-sys-color-on-surface-variant)',
            }}
          >
            <Icon symbol="cloud" size={48} ariaLabel="MediaHub" />
          </div>
        }
      >
        <TopBar
          onMenuClick={() => setSidebarOpen(true)}
          searchQuery={searchQuery}
          onSearch={onSearch}
          themePreference={preference}
          resolvedTheme={resolvedMode}
          onToggleTheme={cyclePreference}
          username={username}
          onLogout={onLogout}
        />
        <div className="mh-layout">
          {showSidebar && (
            <Sidebar
              open={sidebarOpen}
              onClose={() => setSidebarOpen(false)}
              activeFolder={activeFolder}
              username={username}
              onCreateFolder={onCreateFolder}
              folders={folders}
              onSelectFolder={onSelectFolder}
            />
          )}
          <main className="mh-main" role="main">
            {children}
          </main>
        </div>
      </ClientOnly>
    </div>
  );
}