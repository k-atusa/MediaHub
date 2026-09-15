'use client';

import * as React from 'react';

let loadPromise: Promise<void> | null = null;

export function loadMaterialComponents(): Promise<void> {
  if (loadPromise) {
    return loadPromise;
  }

  // NOTE: @material/web components register custom elements at module
  // evaluation time. We MUST load them in the browser (HTMLElement /
  // customElements are not defined in Node, even during a static export
  // prerender). Per the Material Web docs, `md-elevated-card` lives in
  // the labs tree.
  loadPromise = Promise.all([
    import('@material/web/button/filled-button.js'),
    import('@material/web/button/outlined-button.js'),
    import('@material/web/button/text-button.js'),
    import('@material/web/iconbutton/icon-button.js'),
    import('@material/web/button/filled-tonal-button.js'),
    import('@material/web/fab/fab.js'),
    import('@material/web/labs/card/elevated-card.js'),
    import('@material/web/labs/card/outlined-card.js'),
    import('@material/web/dialog/dialog.js'),
    import('@material/web/list/list.js'),
    import('@material/web/list/list-item.js'),
    import('@material/web/menu/menu.js'),
    import('@material/web/menu/menu-item.js'),
    import('@material/web/progress/linear-progress.js'),
    import('@material/web/progress/circular-progress.js'),
    import('@material/web/switch/switch.js'),
    import('@material/web/textfield/outlined-text-field.js'),
    import('@material/web/textfield/filled-text-field.js'),
    import('@material/web/divider/divider.js'),
  ]).then(() => undefined);

  return loadPromise;
}

interface MaterialLoaderProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function MaterialLoader({ children, fallback }: MaterialLoaderProps): React.JSX.Element {
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    loadMaterialComponents().then(() => {
      if (!cancelled) {
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return <>{fallback ?? null}</>;
  }

  return <>{children}</>;
}
