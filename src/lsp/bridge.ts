// Shared main-thread plumbing for any language worker: bridge CodeMirror's LSP client
// (string JSON-RPC) to a worker's MessagePort (structured-clone objects), behind one
// `LspClient` interface. The TS (Volar) and CSS clients both build on this.
import {
  LSPClient,
  serverDiagnostics,
  type Transport,
} from '@codemirror/lsp-client';
import type { Extension } from '@codemirror/state';
import type { FileMap } from '../types';

export const ROOT_URI = 'file:///';

export const ext = (p: string) => p.slice(p.lastIndexOf('.') + 1).toLowerCase();
export const fileUri = (path: string) => ROOT_URI + path;

export interface LspClient {
  /** CM extension wiring completion/diagnostics/hover for `path` (or `[]` if unsupported). */
  support(path: string): Extension;
  /** Push the latest project files to the server (after structural edits). */
  sync(files: FileMap): void;
}

/**
 * Connect a CodeMirror `LSPClient` to a worker's transferred `MessagePort`. The worker
 * writes structured objects; CM speaks JSON strings — so stringify/parse across the port.
 * `serverDiagnostics()` is an `LSPClientExtension` (publishDiagnostics handler), not a CM
 * extension, so it lives on the client config, not the editor.
 */
export function lspClientOverPort(port: MessagePort): LSPClient {
  const handlers = new Set<(msg: string) => void>();
  port.onmessage = (e) => {
    const msg = JSON.stringify(e.data);
    for (const h of handlers) h(msg);
  };
  const transport: Transport = {
    send: (message) => port.postMessage(JSON.parse(message)),
    subscribe: (h) => handlers.add(h),
    unsubscribe: (h) => handlers.delete(h),
  };
  return new LSPClient({
    rootUri: ROOT_URI,
    extensions: [serverDiagnostics()],
  }).connect(transport);
}
