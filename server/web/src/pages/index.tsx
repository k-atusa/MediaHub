'use client';

import * as React from 'react';
import { useRouter } from 'next/router';
import { ClientOnly } from '@/components/ClientOnly';
import { BrandMark } from '@/components/BrandMark';
import { NoticeDialog } from '@/components/NoticeDialog';
import { InviteDialog } from '@/components/InviteDialog';
import { useSessionContext } from '@/context/SessionContext';
import { makeSession } from '@/lib/crypto';
import { fetchNotice, userDataUrl } from '@/lib/api';

export default function LoginPage(): JSX.Element {
  return (
    <ClientOnly
      fallback={
        <div className="mh-login">
          <div className="mh-login__card">
            <BrandMark size="large" />
          </div>
        </div>
      }
    >
      <LoginForm />
    </ClientOnly>
  );
}

function LoginForm(): JSX.Element {
  const router = useRouter();
  const { setSession, session } = useSessionContext();

  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [invitePrompt, setInvitePrompt] = React.useState<null | ((code: string) => Promise<void>)>(null);

  const usernameRef = React.useRef<HTMLInputElement & { value: string }>(null);
  const passwordRef = React.useRef<HTMLInputElement & { value: string }>(null);

  React.useEffect(() => {
    if (session) {
      router.replace('/folder');
    }
  }, [session, router]);

  // Load notice on mount
  React.useEffect(() => {
    let cancelled = false;
    fetchNotice()
      .then((msg) => {
        if (!cancelled && msg && msg.trim() !== '') setNotice(msg);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const promptInvite = (): Promise<string> =>
    new Promise<string>((resolve) => {
      setInvitePrompt(() => async (code: string) => {
        resolve(code);
      });
    });

  const handleLogin = async (): Promise<void> => {
    const userVal = (usernameRef.current?.value ?? username).trim();
    const pwVal = passwordRef.current?.value ?? password;
    if (!userVal || !pwVal) {
      setError('Please enter username and password.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const keyMaterial = await makeSession(userVal, pwVal);
      const exists = await fetch(userDataUrl(keyMaterial.userHash), { method: 'HEAD' });
      // Some servers don't support HEAD — fall back to GET.
      let ok = exists.ok || exists.status === 200;
      if (exists.status === 404) ok = false;
      if (!ok && exists.status !== 405) {
        setError('Invalid credentials.');
        return;
      }
      if (!ok) {
        // Treat 404 as "doesn't exist"
        if (exists.status !== 404) {
          // Fall back to GET to be sure
          const probe = await fetch(userDataUrl(keyMaterial.userHash));
          if (probe.status !== 404) {
            setError('Login failed.');
            return;
          }
          setError('Account not found. Try Register.');
          return;
        }
        setError('Account not found. Try Register.');
        return;
      }
      setSession(keyMaterial);
      router.replace('/folder');
    } catch (e) {
      setError((e as Error).message || 'Login failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (): Promise<void> => {
    const userVal = (usernameRef.current?.value ?? username).trim();
    const pwVal = passwordRef.current?.value ?? password;
    if (!userVal || !pwVal) {
      setError('Please enter username and password.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const keyMaterial = await makeSession(userVal, pwVal);
      const probe = await fetch(userDataUrl(keyMaterial.userHash));
      if (probe.status === 200) {
        setError('Account already exists. Try Login.');
        return;
      }
      // 404 (or anything else) -> attempt register with invite code
      const inviteCode = await promptInvite();
      if (!inviteCode) return;
      const resp = await fetch(userDataUrl(keyMaterial.userHash), {
        method: 'POST',
        headers: { 'X-Invite-Code': inviteCode, 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(0),
      });
      if (!resp.ok) {
        setError(resp.status === 403 ? 'Invalid invite code.' : 'Registration failed.');
        return;
      }
      setSession(keyMaterial);
      router.replace('/folder');
    } catch (e) {
      setError((e as Error).message || 'Registration failed.');
    } finally {
      setBusy(false);
      setInvitePrompt(null);
    }
  };

  return (
    <div className="mh-login">
      <div className="mh-login__card">
        <div className="mh-login__brand">
          <BrandMark size="large" />
        </div>

        <h1
          style={{
            textAlign: 'center',
            margin: '0 0 var(--mh-space-2)',
            fontSize: 28,
            fontWeight: 500,
            color: 'var(--md-sys-color-on-surface)',
          }}
        >
          Welcome to MediaHub
        </h1>
        <p
          style={{
            textAlign: 'center',
            margin: '0 0 var(--mh-space-6)',
            color: 'var(--md-sys-color-on-surface-variant)',
          }}
        >
          Sign in or register to access your encrypted media library.
        </p>

        <div className="mh-login__fields">
          <md-outlined-text-field
            ref={usernameRef}
            label="Username"
            autofocus
            style={{ width: '100%' }}
            onInput={(e: Event) => setUsername((e.target as HTMLInputElement).value)}
          >
            <md-icon-button slot="trailing-icon" aria-label="Username">
              <span className="material-symbols-rounded" aria-hidden>person</span>
            </md-icon-button>
          </md-outlined-text-field>
          <md-outlined-text-field
            ref={passwordRef}
            type="password"
            label="Password"
            style={{ width: '100%' }}
            onInput={(e: Event) => setPassword((e.target as HTMLInputElement).value)}
          >
            <md-icon-button slot="trailing-icon" aria-label="Password">
              <span className="material-symbols-rounded" aria-hidden>lock</span>
            </md-icon-button>
          </md-outlined-text-field>
        </div>

        {error && (
          <div
            role="alert"
            style={{
              color: 'var(--md-sys-color-error)',
              background: 'var(--md-sys-color-error-container)',
              padding: 'var(--mh-space-3)',
              borderRadius: 12,
              marginBottom: 'var(--mh-space-4)',
              fontSize: 14,
            }}
          >
            {error}
          </div>
        )}

        <div className="mh-login__actions">
          <md-outlined-button onClick={handleRegister} disabled={busy}>
            Register
          </md-outlined-button>
          <md-filled-button onClick={handleLogin} disabled={busy}>
            {busy ? 'Working…' : 'Login'}
          </md-filled-button>
        </div>
      </div>

      <NoticeDialog open={!!notice} message={notice ?? ''} onClose={() => setNotice(null)} />
      {invitePrompt && (
        <InviteDialog
          open
          onConfirm={(code) => {
            invitePrompt(code);
            setInvitePrompt(null);
          }}
          onCancel={() => setInvitePrompt(null)}
        />
      )}
    </div>
  );
}