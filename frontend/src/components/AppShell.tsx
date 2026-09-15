'use client';

import * as React from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Icon } from './Icon';
import { ClientOnly } from './ClientOnly';

export interface AppShellProps {
  username?: string;
  activeFolder?: string;
  onCreateFolder?: () => void;
  onSearch?: (query: string) => void;
  children: React.ReactNode;
  showSidebar?: boolean;
}

export function AppShell({
  username,
  activeFolder,
  onCreateFolder,
  onSearch,
  children,
  showSidebar = true,
}: AppShellProps): React.JSX.Element {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [themeMode, setThemeMode] = React.useState<'light' | 'dark'>('light');

  // Pull theme mode from <html data-theme> on mount; the ThemeContext updates
  // the attribute so we listen with a MutationObserver for instant toggle.
  React.useEffect(() => {
    const html = document.documentElement;
    const update = (): void => setThemeMode((html.getAttribute('data-theme') as 'light' | 'dark') || 'light');
    update();
    const obs = new MutationObserver(update);
    obs.observe(html, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  const toggleTheme = (): void => {
    const next = themeMode === 'light' ? 'dark' : 'light';
    html_set_theme(next);
    setThemeMode(next);
  };

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
          onSearch={onSearch}
          themeMode={themeMode}
          onToggleTheme={toggleTheme}
          username={username}
        />
        <div className="mh-layout">
          {showSidebar && (
            <Sidebar
              open={sidebarOpen}
              onClose={() => setSidebarOpen(false)}
              activeFolder={activeFolder}
              username={username}
              onCreateFolder={onCreateFolder}
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

function html_set_theme(mode: 'light' | 'dark'): void {
  // Small adapter so AppShell can stay independent of ThemeContext if needed.
  import('@/styles/theme').then((m) => m.applyTheme(mode)).catch(() => {});
}