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
