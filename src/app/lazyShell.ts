import { lazy, type ComponentType } from 'react';

/**
 * Like `React.lazy`, but on the server (the build-time shell render) the import never
 * resolves — so the Suspense fallback is what gets prerendered, deterministically. This
 * matters because a long-lived dev server would otherwise cache a resolved lazy module
 * and render the real (DOM-dependent) pane during SSR, breaking hydration.
 */
export function lazyShell<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(() =>
    typeof document === 'undefined'
      ? new Promise<{ default: T }>(() => {}) // server: suspend forever → render fallback
      : factory()
  );
}
