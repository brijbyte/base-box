// Main-thread side of the TS language server: spawns the worker, bridges CodeMirror's
// LSP client (string JSON-RPC) to the worker's MessagePort (structured-clone objects),
// and exposes a per-file editor extension + a file-sync hook.
import * as Comlink from 'comlink';
import {
  LSPClient,
  languageServerSupport,
  serverDiagnostics,
  type Transport,
} from '@codemirror/lsp-client';
import type { Extension } from '@codemirror/state';
import type { FileMap } from '../types';
import type { TsWorkerApi } from './ts-worker';

const ROOT_URI = 'file:///';
const LSP_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs']);

const ext = (p: string) => p.slice(p.lastIndexOf('.') + 1).toLowerCase();

/** Whether a file gets language-server features (TS/JS family). */
export const lspSupportsPath = (p: string) => LSP_EXTS.has(ext(p));

const fileUri = (path: string) => ROOT_URI + path;

/** LSP languageId for a path (drives didOpen + server-side language selection). */
function languageId(path: string): string {
  switch (ext(path)) {
    case 'tsx':
      return 'typescriptreact';
    case 'ts':
      return 'typescript';
    case 'jsx':
      return 'javascriptreact';
    default:
      return 'javascript';
  }
}

export interface LspClient {
  /** CM extension wiring completion/diagnostics/hover for `path` (or `[]` if unsupported). */
  support(path: string): Extension;
  /** Push the latest project files to the server (after structural edits). */
  sync(files: FileMap): void;
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

  const handlers = new Set<(msg: string) => void>();
  // Worker writes structured objects; CM expects JSON strings (and vice-versa).
  channel.port1.onmessage = (e) => {
    const msg = JSON.stringify(e.data);
    for (const h of handlers) h(msg);
  };
  const transport: Transport = {
    send: (message) => channel.port1.postMessage(JSON.parse(message)),
    subscribe: (h) => handlers.add(h),
    unsubscribe: (h) => handlers.delete(h),
  };

  // serverDiagnostics is an LSPClientExtension (publishDiagnostics handler), not a CM
  // extension — it must be registered on the client, not added to the editor.
  const client = new LSPClient({
    rootUri: ROOT_URI,
    extensions: [serverDiagnostics()],
  }).connect(transport);

  return {
    support: (path) =>
      lspSupportsPath(path)
        ? languageServerSupport(client, fileUri(path), languageId(path))
        : [],
    sync: (next) => void api.sync(next),
  };
}
