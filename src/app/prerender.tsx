/// <reference types="node" />
// Build-time shell renderer. Bundled + run in Node by the prerender Vite plugin (in an
// isolated SSR build, so the app's browser node-polyfills don't apply here). It renders
// the static app shell — panes, skeletons, status bar — that the client hydrates into.
// The heavy panes (editor, tree) are lazy and never resolve on the server (see lazyShell),
// so the shell contains their Suspense fallbacks; we flush that shell and abort the rest.
import { renderToPipeableStream } from 'react-dom/server';
import { Writable } from 'node:stream';
import { App } from './App';
import type { Controller, Snapshot } from './controller';

// Must match the real Controller's initial snapshot for every field the shell renders
// (theme fields feed only the closed Settings popover, so their values are irrelevant here).
const SHELL_SNAPSHOT: Snapshot = {
  status: '',
  editorStatus: null,
  filename: '(no file)',
  treeReady: false,
  editorReady: false,
  previewTitle: 'Preview',
  preview: { visible: true, label: 'Starting…', error: false },
  previewError: null,
  counts: { error: 0, warn: 0 },
  mode: 'system',
  appearance: 'dark',
  colorTheme: '',
};

// A no-op stand-in: the shell render only reads the snapshot; no methods/effects run.
const shellController = {
  subscribe: () => () => {},
  getSnapshot: () => SHELL_SNAPSHOT,
} as unknown as Controller;

export function render(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });
    sink.on('finish', () => resolve(Buffer.concat(chunks).toString('utf8')));

    const { pipe, abort } = renderToPipeableStream(
      <App controller={shellController} />,
      {
        onShellReady() {
          // The shell — including the panes' Suspense fallbacks and their boundary markers
          // — is ready. Flush it, then abort the boundaries that never resolve server-side;
          // the client hydrates the fallbacks and renders the real panes.
          pipe(sink);
          abort();
        },
        onShellError: reject,
        onError() {
          /* the deliberately-never-resolving lazy panes get aborted — expected */
        },
      }
    );
  });
}
