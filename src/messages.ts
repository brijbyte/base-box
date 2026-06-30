// Typed contracts for the one-way `postMessage` events that cross between the host,
// the Service Worker, and the preview iframe. Unlike the SW/worker RPC (Comlink),
// these stay raw postMessage: the preview runtime is served as generated JS *strings*
// (see hmr.ts) and can't import a library — so a shared type contract is what both
// ends honor instead.

/** `source` tag stamped on preview → host error reports (filtered on the host). */
export const PREVIEW_MSG = 'base-box-preview';

/** An error the preview iframe (or the SW's compile-error stub) reports to the host. */
export interface PreviewErrorMessage {
  source: typeof PREVIEW_MSG;
  type: 'error';
  kind: 'compile' | 'runtime';
  message: string;
  stack?: string;
  file?: string;
}

/** Console levels mirrored from the preview iframe to the host console panel. */
export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

/** A `console.*` call (or uncaught error) the preview iframe forwards to the host. */
export interface PreviewConsoleMessage {
  source: typeof PREVIEW_MSG;
  type: 'console';
  level: ConsoleLevel;
  /** Args pre-serialized in the iframe (it holds the live objects), space-joined. */
  text: string;
}

/** A hot-update the SW broadcasts to preview client(s); consumed by the HMR runtime. */
export interface HmrMessage {
  type: 'hmr';
  reload?: boolean;
  boundaries: { path: string; url: string }[];
}

/** Subscribe to preview-error reports posted by the iframe runtime onto `window`. */
export function onPreviewError(
  handler: (msg: PreviewErrorMessage) => void
): void {
  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data;
    if (d?.source === PREVIEW_MSG && d.type === 'error') {
      handler(d as PreviewErrorMessage);
    }
  });
}

/** Subscribe to `console.*` mirrors posted by the iframe runtime onto `window`. */
export function onPreviewConsole(
  handler: (msg: PreviewConsoleMessage) => void
): void {
  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data;
    if (d?.source === PREVIEW_MSG && d.type === 'console') {
      handler(d as PreviewConsoleMessage);
    }
  });
}
