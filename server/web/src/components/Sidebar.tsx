'use client';

import * as React from 'react';
import Link from 'next/link';
import { Icon } from './Icon';

export interface SidebarProps {
  open: boolean;
  onClose: () => void;
  activeFolder?: string;
  username?: string;
  onCreateFolder?: () => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: string;
  href: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'my-drive', label: 'My Drive', icon: 'hard_drive', href: '/folder?folder=My%20Drive' },
  { id: 'shared', label: 'Shared with me', icon: 'group', href: '/folder?folder=Shared' },
  { id: 'recent', label: 'Recent', icon: 'schedule', href: '/folder?folder=Recent' },
  { id: 'trash', label: 'Trash', icon: 'delete', href: '/folder?folder=Trash' },
];

export function Sidebar({ open, onClose, activeFolder, username, onCreateFolder }: SidebarProps): JSX.Element {
  const handleLinkClick = (): void => {
    onClose();
  };

  return (
    <>
      <div
        className={`mh-sidebar__overlay ${open ? 'mh-sidebar__overlay--open' : ''}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={`mh-sidebar ${open ? 'mh-sidebar--open' : ''}`}
        aria-label="Main navigation"
        aria-hidden={!open}
      >
        <div className="mh-sidebar__actions" style={{ padding: '0 var(--mh-space-2) var(--mh-space-3)' }}>
          <md-filled-button
            class="mh-sidebar__new-folder"
            style={{ width: '100%' }}
            aria-label="Create new folder"
            onClick={onCreateFolder}
          >
            <Icon symbol="create_new_folder" slot="icon" ariaLabel="" />
            New folder
          </md-filled-button>
        </div>

        <nav className="mh-sidebar__nav" aria-label="Drive navigation">
          {NAV_ITEMS.map((item) => {
            const isActive = activeFolder ? item.href.includes(`folder=${encodeURIComponent(activeFolder)}`) : item.id === 'my-drive';
            return (
              <Link
                key={item.id}
                href={item.href}
                className={`mh-sidebar__link ${isActive ? 'mh-sidebar__link--active' : ''}`}
                onClick={handleLinkClick}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon symbol={item.icon} filled={isActive} ariaLabel="" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {username && (
          <div
            style={{
              marginTop: 'auto',
              padding: 'var(--mh-space-4)',
              borderTop: '1px solid var(--md-sys-color-outline-variant)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--mh-space-3)',
              color: 'var(--md-sys-color-on-surface-variant)',
              fontSize: 14,
            }}
          >
            <span className="mh-avatar" aria-hidden>
              {username.slice(0, 2)}
            </span>
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {username}
            </span>
          </div>
        )}
      </aside>
    </>
  );
}
