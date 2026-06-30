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
import {
  initTheme,
  setMode,
  setColorTheme,
  getColorTheme,
  effectiveAppearance,
  appearanceForMode,
  loadTheme,
  onSystemAppearanceChange,
  getMode,
  THEMES,
  type Mode,
} from './theme';
import { downloadZip } from './zip';
import {
  onPreviewError,
  onPreviewConsole,
  type ConsoleLevel,
} from './messages';
import { createEditor, type EditorStatus } from './editor';
import { createFileTree, type FileTreePanel } from './filetree';
import { initResizablePanes } from './resize';
import type { LspClient } from './lsp/bridge'; // type-only: no runtime import

const fs = new MemFS((await filesFromUrl()) ?? SAMPLE);

// Language servers (each in a worker): autocomplete, diagnostics, hover. Both the client
// module and its worker load lazily on the first matching file opened — a project that only
// touches HTML/CSS never pulls the (CDN-heavy) TS server, and vice-versa.
const extOf = (p: string) => p.slice(p.lastIndexOf('.') + 1).toLowerCase();
const TS_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs']);
const CSS_EXTS = new Set(['css', 'scss', 'less']);

/** A lazily-created LSP client: imported + booted on first use, then memoized. */
function lazyLsp(load: () => Promise<LspClient>) {
  let inst: LspClient | null = null;
  let loading: Promise<LspClient> | null = null;
  return {
    ensure: (): Promise<LspClient> =>
      inst
        ? Promise.resolve(inst)
        : (loading ??= load().then((c) => (inst = c))),
    instance: () => inst,
  };
}

const tsLsp = lazyLsp(() =>
  import('./lsp/client').then(({ createLspClient }) =>
    createLspClient(fs.toJSON())
  )
);
const cssLsp = lazyLsp(() =>
  import('./lsp/css-client').then(({ createCssLspClient }) =>
    createCssLspClient()
  )
);

/** The language server (if any) that handles `path`, by extension. */
function lspFor(path: string) {
  const e = extOf(path);
  if (TS_EXTS.has(e)) return tsLsp;
  if (CSS_EXTS.has(e)) return cssLsp;
  return null;
}

const els = {
  tree: document.querySelector<HTMLDivElement>('#tree')!,
  editor: document.querySelector<HTMLDivElement>('#editor')!,
  iframe: document.querySelector<HTMLIFrameElement>('#preview')!,
  status: document.querySelector<HTMLSpanElement>('#status')!,
  share: document.querySelector<HTMLButtonElement>('#share')!,
  download: document.querySelector<HTMLButtonElement>('#download')!,
  mode: document.querySelector<HTMLSelectElement>('#mode')!,
  colorTheme: document.querySelector<HTMLSelectElement>('#colorTheme')!,
  settings: document.querySelector<HTMLButtonElement>('#settings')!,
  settingsPanel: document.querySelector<HTMLDivElement>('#settingsPanel')!,
  filename: document.querySelector<HTMLDivElement>('#filename')!,
  newFile: document.querySelector<HTMLButtonElement>('#new')!,
  rename: document.querySelector<HTMLButtonElement>('#rename')!,
  del: document.querySelector<HTMLButtonElement>('#delete')!,
  treeLoading: document.querySelector<HTMLDivElement>('#treeLoading')!,
  editorLoading: document.querySelector<HTMLDivElement>('#editorLoading')!,
  previewTitle: document.querySelector<HTMLSpanElement>('#previewTitle')!,
  previewReload: document.querySelector<HTMLButtonElement>('#previewReload')!,
  previewLoading: document.querySelector<HTMLDivElement>('#previewLoading')!,
  previewLabel: document.querySelector<HTMLSpanElement>('#previewLabel')!,
  previewError: document.querySelector<HTMLDivElement>('#previewError')!,
  errorTitle: document.querySelector<HTMLSpanElement>('#errorTitle')!,
  errorMessage: document.querySelector<HTMLPreElement>('#errorMessage')!,
  errorDismiss: document.querySelector<HTMLButtonElement>('#errorDismiss')!,
  console: document.querySelector<HTMLDivElement>('#console')!,
  consoleLog: document.querySelector<HTMLDivElement>('#consoleLog')!,
  consoleToggle: document.querySelector<HTMLButtonElement>('#consoleToggle')!,
  consoleClear: document.querySelector<HTMLButtonElement>('#consoleClear')!,
  consoleFilters: document.querySelector<HTMLSpanElement>('#consoleFilters')!,
  diagnostics: document.querySelector<HTMLSpanElement>('#diagnostics')!,
  cursorPos: document.querySelector<HTMLSpanElement>('#cursorPos')!,
  indent: document.querySelector<HTMLSpanElement>('#indent')!,
  language: document.querySelector<HTMLSpanElement>('#language')!,
};

initResizablePanes();

let current = '';
let panel: FileTreePanel;

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
    debounce = setTimeout(() => {
      // Keep each running LSP's snapshot current so cross-file imports see edits,
      // not just structural changes (rebuild). Otherwise importers read a stale copy.
      const files = fs.toJSON();
      tsLsp.instance()?.sync(files);
      cssLsp.instance()?.sync(files);
      hotUpdate(path, value);
    }, 300);
  },
  {
    lspSupport: (path) => {
      const lsp = lspFor(path);
      return lsp ? lsp.ensure().then((c) => c.support(path)) : [];
    },
    onStatus: renderStatus,
  }
);

// Reflect the editor's live state into the status bar's right-hand info group.
function renderStatus(s: EditorStatus) {
  const sel = s.selected ? ` (${s.selected} selected)` : '';
  els.cursorPos.textContent = `Ln ${s.line}, Col ${s.col}${sel}`;
  els.indent.textContent = s.indent;
  els.language.textContent = s.language;
  if (s.errors || s.warnings) {
    els.diagnostics.textContent = `✖ ${s.errors}  ⚠ ${s.warnings}`;
    els.diagnostics.toggleAttribute('data-errors', s.errors > 0);
  } else {
    els.diagnostics.textContent = '✓ 0';
    els.diagnostics.removeAttribute('data-errors');
  }
}

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
  syncPreviewTitle();
  if (!previewArmed) return;
  previewArmed = false;
  els.previewLoading.hidden = true;
});

// Mirror the preview document's <title> into the pane bar; fall back to "Preview".
function syncPreviewTitle() {
  const title = els.iframe.contentDocument?.title?.trim();
  els.previewTitle.textContent = title || 'Preview';
}

// Force a full reload of the preview from scratch (re-fetch + re-evaluate the app).
els.previewReload.addEventListener('click', () => reloadPreview());

function setPreviewLabel(label: string) {
  els.previewLabel.textContent = label;
  els.previewLoading.removeAttribute('data-error');
  els.previewLoading.hidden = false;
}

/** Show the overlay, then (re)load the iframe; the `load` handler hides it. */
function reloadPreview(label = 'Loading preview…') {
  clearPreviewError(); // fresh load; the iframe re-posts any error that still applies
  clearConsole(); // fresh page: drop the previous run's console output
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
onPreviewError((d) => {
  // WebKit stacks omit the message line, so show the message and append the stack.
  const msg = d.message || 'Unknown error';
  const body =
    d.stack && !d.stack.includes(msg) ? `${msg}\n\n${d.stack}` : d.stack || msg;
  showPreviewError(d.kind, body, d.file);
});

// --- Console panel ---
// Mirrors the preview iframe's console.* output (forwarded via postMessage; see hmr.ts).
const counts: Record<ConsoleLevel, number> = {
  log: 0,
  info: 0,
  warn: 0,
  error: 0,
  debug: 0,
};
let lastRow: HTMLDivElement | null = null;
let lastKey = '';

function updateConsoleCounts() {
  for (const level of ['error', 'warn'] as const) {
    const badge = els.consoleFilters.querySelector<HTMLSpanElement>(
      `[data-count="${level}"]`
    );
    if (badge) badge.textContent = counts[level] ? String(counts[level]) : '';
  }
}

function clearConsole() {
  els.consoleLog.replaceChildren();
  lastRow = null;
  lastKey = '';
  for (const k of Object.keys(counts) as ConsoleLevel[]) counts[k] = 0;
  updateConsoleCounts();
}

function setConsoleCollapsed(collapsed: boolean) {
  els.console.classList.toggle('is-collapsed', collapsed);
  els.consoleToggle.setAttribute('aria-expanded', String(!collapsed));
}

function appendConsole(level: ConsoleLevel, text: string) {
  counts[level]++;
  updateConsoleCounts();

  // Coalesce identical consecutive lines (devtools-style) into a repeat badge.
  const key = `${level} ${text}`;
  if (key === lastKey && lastRow) {
    let badge = lastRow.querySelector<HTMLSpanElement>('.console-repeat');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'console-repeat';
      badge.textContent = '1';
      lastRow.prepend(badge);
    }
    badge.textContent = String(Number(badge.textContent) + 1);
    return;
  }

  const atBottom =
    els.consoleLog.scrollTop + els.consoleLog.clientHeight >=
    els.consoleLog.scrollHeight - 4;
  const row = document.createElement('div');
  row.className = 'console-row';
  row.dataset.level = level;
  const body = document.createElement('span');
  body.className = 'console-text';
  body.textContent = text;
  row.append(body);
  els.consoleLog.append(row);
  lastRow = row;
  lastKey = key;

  if (atBottom) els.consoleLog.scrollTop = els.consoleLog.scrollHeight;
}

els.consoleClear.addEventListener('click', clearConsole);
els.consoleToggle.addEventListener('click', () =>
  setConsoleCollapsed(!els.console.classList.contains('is-collapsed'))
);
els.consoleFilters.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
    '.console-filter'
  );
  if (!btn) return;
  els.consoleFilters
    .querySelectorAll('.console-filter')
    .forEach((b) => b.classList.toggle('is-active', b === btn));
  els.consoleLog.dataset.filter = btn.dataset.level ?? 'all';
  setConsoleCollapsed(false);
});
onPreviewConsole((d) => appendConsole(d.level, d.text));

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
  syncUrlFile(path);
}

/** Persist the open file in the URL (?file=) so a refresh re-selects it. */
function syncUrlFile(path: string) {
  const url = new URL(location.href);
  if (path) url.searchParams.set('file', path);
  else url.searchParams.delete('file');
  history.replaceState(null, '', url);
}

async function rebuild() {
  setStatus('syncing…');
  // Keep each running language server's file map current (no-op until it's booted).
  const files = fs.toJSON();
  tsLsp.instance()?.sync(files);
  cssLsp.instance()?.sync(files);
  const count = await syncFiles(files);
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

// --- Settings popover (gear toggles it; outside-click / Escape closes) ---
function setSettingsOpen(open: boolean) {
  els.settingsPanel.hidden = !open;
  els.settings.setAttribute('aria-expanded', String(open));
}
els.settings.addEventListener('click', (e) => {
  e.stopPropagation();
  setSettingsOpen(!!els.settingsPanel.hidden);
});
document.addEventListener('click', (e) => {
  if (
    !els.settingsPanel.hidden &&
    !els.settings.parentElement!.contains(e.target as Node)
  )
    setSettingsOpen(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setSettingsOpen(false);
});

// --- Theme ---
// Two axes (see theme.ts): MODE (light/dark/system) and the COLOR theme per appearance.
// Both flip data-* attrs on <html>; the var-based CM theme, tree (--trees-* overrides) and
// chrome all follow with no reconfigure. The color-theme select lists the themes for the
// *effective* appearance (so dark themes when dark is showing, light themes when light).
initTheme();
els.mode.value = getMode();
function syncColorThemes() {
  const appearance = effectiveAppearance();
  els.colorTheme.replaceChildren(
    ...THEMES[appearance].map((t) => new Option(t.label, t.id))
  );
  els.colorTheme.value = getColorTheme(appearance);
}
syncColorThemes();
els.mode.addEventListener('change', async () => {
  const mode = els.mode.value as Mode;
  // Preload the theme the new mode will make effective, so the switch doesn't flash.
  const appearance = appearanceForMode(mode);
  await loadTheme(appearance, getColorTheme(appearance));
  setMode(mode);
  syncColorThemes();
});
els.colorTheme.addEventListener('change', () =>
  setColorTheme(effectiveAppearance(), els.colorTheme.value)
);
// While mode='system', an OS-preference flip changes the effective appearance: load its
// theme (the data-*-theme attr is already set, the CSS just needs fetching) and re-sync.
onSystemAppearanceChange(() => {
  if (getMode() !== 'system') return;
  const appearance = effectiveAppearance();
  void loadTheme(appearance, getColorTheme(appearance));
  syncColorThemes();
});

els.share.addEventListener('click', async () => {
  const u = new URL(`${location.origin}${location.pathname}`);
  u.searchParams.set('files', await encodeFiles(fs.toJSON()));
  if (current) u.searchParams.set('file', current);
  const url = u.toString();
  await navigator.clipboard?.writeText(url).catch(() => {});
  history.replaceState(null, '', url);
  setStatus('share URL copied');
  setSettingsOpen(false);
});

els.download.addEventListener('click', () => {
  downloadZip('base-box', fs.toJSON());
  setStatus('downloaded base-box.zip');
});

async function boot() {
  // Chrome renders immediately from the already-decoded FS — only the preview waits on
  // the service worker + esbuild-wasm, so reveal the tree/editor first.
  // Prefer the file named in the URL (?file=) so a refresh re-selects it.
  const fromUrl = new URLSearchParams(location.search).get('file');
  const initial =
    fromUrl && fs.has(fromUrl)
      ? fromUrl
      : fs.has('index.html')
        ? 'index.html'
        : firstFile();
  panel = createFileTree(els.tree, fs.list(), initial, {
    onOpen: openFile,
    onAdd,
    onRemove,
    onMove,
  });
  els.treeLoading.hidden = true;
  els.treeLoading.parentElement?.classList.remove('tree-loading');
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
