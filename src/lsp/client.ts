// Main-thread side of the TS language server: spawns the Volar worker, connects it to a
// CodeMirror LSP client (via the shared bridge), and exposes a per-file support extension
// + a file-sync hook.
import * as Comlink from 'comlink';
import { languageServerSupport } from '@codemirror/lsp-client';
import type { FileMap } from '../types';
import type { TsWorkerApi } from './ts-worker';
import { ext, fileUri, lspClientOverPort, type LspClient } from './bridge';

const TS_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue']);

/** Whether a file gets TS/JS language-server features. */
export const lspSupportsPath = (p: string) => TS_EXTS.has(ext(p));

/** LSP languageId for a path (drives didOpen + server-side language selection). */
function languageId(path: string): string {
  switch (ext(path)) {
    case 'tsx':
      return 'typescriptreact';
    case 'ts':
      return 'typescript';
    case 'jsx':
      return 'javascriptreact';
    case 'vue':
      return 'vue';
    default:
      return 'javascript';
  }
}

/** Boot the TS worker and connect a CodeMirror LSP client to it. */
export function createLspClient(files: FileMap): LspClient {
  const worker = new Worker(new URL('./ts-worker.ts', import.meta.url), {
    type: 'module',
  });
  const api = Comlink.wrap<TsWorkerApi>(worker);
  // LSP runs over a dedicated port; Comlink owns `self`, so we hand the port to init().
  const channel = new MessageChannel();
  void api.init(files, Comlink.transfer(channel.port2, [channel.port2]));

  const client = lspClientOverPort(channel.port1);

  return {
    support: (path) =>
      lspSupportsPath(path)
        ? languageServerSupport(client, fileUri(path), languageId(path))
        : [],
    sync: (next) => void api.sync(next),
  };
}
