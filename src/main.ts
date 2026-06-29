import './polyfill';
import { MemFS, normalizePath } from './fs';
import { filesFromUrl, encodeFiles } from './codec';
import { SAMPLE } from './sample';
import {
  registerServiceWorker,
  syncFiles,
  refreshPreview,
  onControllerChange,
} from './preview';
import {
  initTheme,
  cycleTheme,
  isDark,
  onSystemThemeChange,
  type Theme,
} from './theme';
import { createEditor } from './editor';
import { createFileTree, type FileTreePanel } from './filetree';

const fs = new MemFS(filesFromUrl() ?? SAMPLE);

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
};

let current = '';
let theme: Theme = initTheme();
let panel: FileTreePanel;

const themeLabel = (t: Theme) => `Theme: ${t[0].toUpperCase()}${t.slice(1)}`;
const firstFile = () => fs.list()[0] ?? '';

// Debounced write+rebuild on user edits.
let debounce: ReturnType<typeof setTimeout>;
const editor = createEditor(els.editor, (value) => {
  if (!current) return;
  fs.write(current, value);
  clearTimeout(debounce);
  debounce = setTimeout(rebuild, 300);
});

function setStatus(msg: string) {
  els.status.textContent = msg;
}

function openFile(path: string) {
  current = path;
  els.filename.textContent = path || '(no file)';
  editor.setFile(path, fs.read(path) ?? '');
}

async function rebuild() {
  setStatus('syncing…');
  const count = await syncFiles(fs.toJSON());
  refreshPreview(els.iframe);
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
  const input = prompt('New file path (e.g. src/util.ts):');
  if (!input) return;
  const path = normalizePath(input);
  if (!path || fs.has(path)) return;
  panel.add(path); // → onAdd
  panel.select(path);
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
function applyTheme() {
  const dark = isDark(theme);
  editor.setDark(dark);
  panel?.setTheme(dark);
}
els.theme.textContent = themeLabel(theme);
els.theme.addEventListener('click', () => {
  theme = cycleTheme();
  els.theme.textContent = themeLabel(theme);
  applyTheme();
});
onSystemThemeChange(() => {
  if (theme === 'system') applyTheme();
});

els.share.addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?files=${encodeFiles(fs.toJSON())}`;
  await navigator.clipboard?.writeText(url).catch(() => {});
  history.replaceState(null, '', url);
  setStatus('share URL copied');
});

async function boot() {
  setStatus('registering service worker…');
  await registerServiceWorker();
  onControllerChange(() =>
    rebuild().catch((err) => setStatus(`error: ${err.message}`))
  );

  const initial = fs.has('index.html') ? 'index.html' : firstFile();
  panel = createFileTree(els.tree, fs.list(), initial, {
    onOpen: openFile,
    onAdd,
    onRemove,
    onMove,
  });
  openFile(initial);
  applyTheme();
  await rebuild();
}

boot().catch((err) => setStatus(`error: ${err.message}`));
