import * as React from 'react';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { ThemeProvider } from '@/context/ThemeContext';
import { SessionProvider } from '@/context/SessionContext';
import { MaterialLoader } from '@/components/MaterialLoader';
import '@/styles/globals.css';

export default function App({ Component, pageProps }: AppProps): React.JSX.Element {
  return (
    <>
      <Head>
        <title>MediaHub</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>
      <ThemeProvider>
        <SessionProvider>
          <MaterialLoader
            fallback={
              <div
                style={{
                  minHeight: '100vh',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--md-sys-color-on-surface-variant)',
                  fontFamily: "'Google Sans Flex', 'Google Sans', system-ui, sans-serif",
                }}
              >
                Loading MediaHub…
              </div>
            }
          >
            <Component {...pageProps} />
          </MaterialLoader>
        </SessionProvider>
      </ThemeProvider>
    </>
  );
}