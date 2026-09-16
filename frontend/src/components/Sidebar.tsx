'use client';

import * as React from 'react';
import { Icon } from './Icon';

export interface SidebarProps {
  open: boolean;
  onClose: () => void;
  activeFolder?: string;
  username?: string;
  onCreateFolder?: () => void;
  folders?: string[];
  onSelectFolder?: (folder: string) => void;
}

export function Sidebar({
  open,
  onClose,
  activeFolder,
  username,
  onCreateFolder,
  folders,
  onSelectFolder,
}: SidebarProps): React.JSX.Element {
  return (
    <>
      <div
        className={`mh-sidebar__overlay ${open ? 'mh-sidebar__overlay--open' : ''}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={`mh-sidebar ${open ? 'mh-sidebar--open' : ''}`}
        aria-label="Folders navigation"
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

        <div style={{ padding: '0 var(--mh-space-2)', flex: 1, overflowY: 'auto' }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--md-sys-color-on-surface-variant)',
              textTransform: 'uppercase',
              letterSpacing: 0.8,
              padding: 'var(--mh-space-2) var(--mh-space-3)',
            }}
          >
            Folders
          </div>
          {folders && folders.length > 0 ? (
            <nav className="mh-sidebar__nav" aria-label="User folders">
              {folders.map((fName) => {
                const isActive = fName === activeFolder;
                return (
                  <button
                    key={fName}
                    type="button"
                    className={`mh-sidebar__link ${isActive ? 'mh-sidebar__link--active' : ''}`}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      font: 'inherit',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--mh-space-3)',
                    }}
                    onClick={() => {
                      onClose();
                      onSelectFolder?.(fName);
                    }}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon symbol="folder" filled={isActive} ariaLabel="" />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {fName}
                    </span>
                  </button>
                );
              })}
            </nav>
          ) : (
            <div
              style={{
                padding: 'var(--mh-space-2) var(--mh-space-3)',
                fontSize: 13,
                color: 'var(--md-sys-color-on-surface-variant)',
                opacity: 0.7,
              }}
            >
              No folders yet
            </div>
          )}
        </div>

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
