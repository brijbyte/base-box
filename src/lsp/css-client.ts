// Main-thread side of the CSS language server: spawns the CSS worker and connects it to a
// CodeMirror LSP client via the shared bridge. CSS validation is per-document, so there's
// no project file-map to sync (sync() is a no-op).
import * as Comlink from 'comlink';
import { languageServerSupport } from '@codemirror/lsp-client';
import type { CssWorkerApi } from './css-worker';
import { ext, fileUri, lspClientOverPort, type LspClient } from './bridge';

const CSS_EXTS = new Set(['css', 'scss', 'less']);

/** Whether a file gets CSS-family language-server features. */
export const cssSupportsPath = (p: string) => CSS_EXTS.has(ext(p));

/** LSP languageId for a path (`module.css` → plain `css`). */
const languageId = (path: string) => ext(path);

/** Boot the CSS worker and connect a CodeMirror LSP client to it. */
export function createCssLspClient(): LspClient {
  const worker = new Worker(new URL('./css-worker.ts', import.meta.url), {
    type: 'module',
  });
  const api = Comlink.wrap<CssWorkerApi>(worker);
  const channel = new MessageChannel();
  void api.init(Comlink.transfer(channel.port2, [channel.port2]));

  const client = lspClientOverPort(channel.port1);

  return {
    support: (path) =>
      cssSupportsPath(path)
        ? languageServerSupport(client, fileUri(path), languageId(path))
        : [],
    sync: () => {},
  };
}
