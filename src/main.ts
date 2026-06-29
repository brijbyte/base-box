import './polyfill';
import { MemFS } from './fs';
import { filesFromUrl, encodeFiles } from './codec';
import { SAMPLE } from './sample';
import {
  registerServiceWorker,
  syncFiles,
  updateFile,
  refreshPreview,
  onControllerChange,
} from './preview';
import { initTheme, cycleTheme, type Theme } from './theme';
import { createEditor } from './editor';
import { createFileTree, type FileTreePanel } from './filetree';
import { createLspClient, lspSupportsPath, type LspClient } from './lsp/client';

const fs = new MemFS((await filesFromUrl()) ?? SAMPLE);

// TypeScript language server (worker): autocomplete, diagnostics, hover.
// Spawned lazily on the first TS/JS file opened — it pulls TS from a CDN, so a
// project that never opens a code file (or only HTML/CSS) never pays for it.
let lsp: LspClient | null = null;
function ensureLsp(): LspClient {
  if (!lsp) lsp = createLspClient(fs.toJSON());
  return lsp;
}

const els = {
  tree: document.querySelector<HTMLDivElement>('#tree')!,
  editor: document.querySelector<HTMLDivElement>('#editor')!,
  iframe: document.querySelector<HTMLIFrameElement>('#preview')!,
  status: document.querySelector<HTMLSpanElement>('#status')!,
  share: document.querySelector<HTMLButtonElement>('#share')!,
  theme: document.querySelector<HTMLButtonElement>('#theme')!,
  filename: document.querySelector<HTMLDivElement>('#filename')!,
  newFile: document.querySelector<HTMLButtonElement>('#new')!,
  rename: document.querySelector<HTMLButtonElement>('#rename')!,
  del: document.querySelector<HTMLButtonElement>('#delete')!,
  treeLoading: document.querySelector<HTMLDivElement>('#treeLoading')!,
  editorLoading: document.querySelector<HTMLDivElement>('#editorLoading')!,
  previewLoading: document.querySelector<HTMLDivElement>('#previewLoading')!,
  previewLabel: document.querySelector<HTMLSpanElement>('#previewLabel')!,
  previewError: document.querySelector<HTMLDivElement>('#previewError')!,
  errorTitle: document.querySelector<HTMLSpanElement>('#errorTitle')!,
  errorMessage: document.querySelector<HTMLPreElement>('#errorMessage')!,
  errorDismiss: document.querySelector<HTMLButtonElement>('#errorDismiss')!,
};

let current = '';
let theme: Theme = initTheme();
let panel: FileTreePanel;

const themeLabel = (t: Theme) => `Theme: ${t[0].toUpperCase()}${t.slice(1)}`;
const firstFile = () => fs.list()[0] ?? '';

// Debounced write + hot update on user edits.
let debounce: ReturnType<typeof setTimeout>;
const editor = createEditor(
  els.editor,
  (value) => {
    if (!current) return;
    fs.write(current, value);
    const path = current;
    clearTimeout(debounce);
    debounce = setTimeout(() => hotUpdate(path, value), 300);
  },
  {
    lspSupport: (path) =>
      lspSupportsPath(path) ? ensureLsp().support(path) : [],
  }
);

// Try to hot-swap the changed module; fall back to a full reload when the SW says so.
async function hotUpdate(path: string, content: string) {
  setStatus('updating…');
  clearPreviewError(); // stale error clears on edit; re-posted by the iframe if it recurs
  try {
    const { reload, boundaries } = await updateFile(path, content);
    if (reload) {
      reloadPreview('Reloading…');
      setStatus(`reloaded (${path})`);
    } else {
      setStatus(`hot-updated ${boundaries.join(', ') || path}`);
    }
  } catch (err) {
    setStatus(`error: ${(err as Error).message}`);
  }
}

function setStatus(msg: string) {
  els.status.textContent = msg;
}

// --- Preview loading overlay ---
// `load` on a module-script iframe fires only after the module graph evaluates (i.e. the
// app has rendered), so it's a reliable "preview ready" signal. `armed` ignores the
// initial about:blank load that fires before we ever set a real src.
let previewArmed = false;
els.iframe.addEventListener('load', () => {
  if (!previewArmed) return;
  previewArmed = false;
  els.previewLoading.hidden = true;
});

function setPreviewLabel(label: string) {
  els.previewLabel.textContent = label;
  els.previewLoading.removeAttribute('data-error');
  els.previewLoading.hidden = false;
}

/** Show the overlay, then (re)load the iframe; the `load` handler hides it. */
function reloadPreview(label = 'Loading preview…') {
  clearPreviewError(); // fresh load; the iframe re-posts any error that still applies
  setPreviewLabel(label);
  previewArmed = true;
  refreshPreview(els.iframe);
}

// --- Preview error overlay ---
// The preview iframe (and the SW's compile-error stub) postMessage errors here; see hmr.ts.
function clearPreviewError() {
  els.previewError.hidden = true;
}
// Turn SW URLs (origin + /__fs/ + ?t stamps) into the project-relative FS path.
const FS_URL_RE = new RegExp(
  `${location.origin}/__fs/([^?\\s)]*)(\\?t=\\d+)?`,
  'g'
);
const toRelativePaths = (s: string) => s.replace(FS_URL_RE, '$1');

function showPreviewError(kind: string, message: string, file?: string) {
  els.errorTitle.textContent =
    kind === 'compile'
      ? `Compile error${file ? ` — ${toRelativePaths(file)}` : ''}`
      : 'Runtime error';
  els.errorMessage.textContent = toRelativePaths(message);
  els.previewError.hidden = false;
}
els.errorDismiss.addEventListener('click', clearPreviewError);
window.addEventListener('message', (e: MessageEvent) => {
  const d = e.data;
  if (!d || d.source !== 'base-box-preview' || d.type !== 'error') return;
  // WebKit stacks omit the message line, so show the message and append the stack.
  const msg = d.message || 'Unknown error';
  const body =
    d.stack && !d.stack.includes(msg) ? `${msg}\n\n${d.stack}` : d.stack || msg;
  showPreviewError(d.kind, body, d.file);
});

function setPreviewError(msg: string) {
  previewArmed = false;
  els.previewLabel.textContent = msg;
  els.previewLoading.setAttribute('data-error', '');
  els.previewLoading.hidden = false;
}

function openFile(path: string) {
  current = path;
  els.filename.textContent = path || '(no file)';
  editor.setFile(path, fs.read(path) ?? '');
}

async function rebuild() {
  setStatus('syncing…');
  lsp?.sync(fs.toJSON()); // keep the language server's file map current (if running)
  const count = await syncFiles(fs.toJSON());
  reloadPreview('Compiling…');
  setStatus(`synced ${count} files`);
}

// --- FS structural helpers (mirror tree mutations) ---
function fsRemove(path: string) {
  for (const f of fs.list()) {
    if (f === path || f.startsWith(path + '/')) fs.delete(f);
  }
}
function fsMove(from: string, to: string) {
  for (const f of fs.list()) {
    if (f === from || f.startsWith(from + '/')) {
      const dest = to + f.slice(from.length);
      fs.write(dest, fs.read(f) ?? '');
      fs.delete(f);
    }
  }
}

// --- Tree → FS sync handlers ---
function onAdd(path: string) {
  if (!fs.has(path)) fs.write(path, '');
  openFile(path);
  rebuild();
}
function onRemove(path: string) {
  fsRemove(path);
  if (current === path || current.startsWith(path + '/')) {
    const next = firstFile();
    if (next) openFile(next);
    else openFile('');
  }
  rebuild();
}
function onMove(from: string, to: string) {
  fsMove(from, to);
  if (current === from || current.startsWith(from + '/')) {
    openFile(to + current.slice(from.length));
  }
  rebuild();
}

// --- Toolbar ---
els.newFile.addEventListener('click', () => {
  panel.startCreate(); // inline new-file: add placeholder + rename in place
});
els.rename.addEventListener('click', () => {
  const p = panel.selected() ?? current;
  if (p) panel.startRename(p); // inline edit → onMove
});
els.del.addEventListener('click', () => {
  const p = panel.selected() ?? current;
  if (p) panel.remove(p); // → onRemove
});

// --- Theme ---
// Styling is CSS-variable driven: cycleTheme() flips `data-theme` on <html> and the
// editor (var-based CM theme), tree (cascading --trees-* overrides) and chrome follow.
els.theme.textContent = themeLabel(theme);
els.theme.addEventListener('click', () => {
  theme = cycleTheme();
  els.theme.textContent = themeLabel(theme);
});

els.share.addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?files=${await encodeFiles(fs.toJSON())}`;
  await navigator.clipboard?.writeText(url).catch(() => {});
  history.replaceState(null, '', url);
  setStatus('share URL copied');
});

async function boot() {
  // Chrome renders immediately from the already-decoded FS — only the preview waits on
  // the service worker + esbuild-wasm, so reveal the tree/editor first.
  const initial = fs.has('index.html') ? 'index.html' : firstFile();
  panel = createFileTree(els.tree, fs.list(), initial, {
    onOpen: openFile,
    onAdd,
    onRemove,
    onMove,
  });
  els.treeLoading.hidden = true;
  openFile(initial);
  els.editorLoading.hidden = true;

  setPreviewLabel('Starting service worker…');
  setStatus('registering service worker…');
  await registerServiceWorker();
  onControllerChange(() =>
    rebuild().catch((err) => setStatus(`error: ${err.message}`))
  );
  await rebuild();
}

boot().catch((err) => {
  setStatus(`error: ${err.message}`);
  setPreviewError(`Failed to start: ${err.message}`);
});
