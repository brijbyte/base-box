import './polyfill';
import { MemFS } from './fs';
import { filesFromUrl, encodeFiles } from './codec';
import { SAMPLE } from './sample';
import {
  registerServiceWorker,
  syncFiles,
  refreshPreview,
  onControllerChange,
} from './preview';
import { initTheme, cycleTheme, type Theme } from './theme';

const fs = new MemFS(filesFromUrl() ?? SAMPLE);

const els = {
  files: document.querySelector<HTMLSelectElement>('#files')!,
  editor: document.querySelector<HTMLTextAreaElement>('#editor')!,
  iframe: document.querySelector<HTMLIFrameElement>('#preview')!,
  status: document.querySelector<HTMLSpanElement>('#status')!,
  share: document.querySelector<HTMLButtonElement>('#share')!,
  theme: document.querySelector<HTMLButtonElement>('#theme')!,
};

let current = '';

const themeLabel = (t: Theme) => `Theme: ${t[0].toUpperCase()}${t.slice(1)}`;

function setStatus(msg: string) {
  els.status.textContent = msg;
}

function refreshFileList() {
  els.files.innerHTML = '';
  for (const path of fs.list()) {
    const opt = document.createElement('option');
    opt.value = opt.textContent = path;
    els.files.append(opt);
  }
}

function openFile(path: string) {
  current = path;
  els.files.value = path;
  els.editor.value = fs.read(path) ?? '';
}

async function rebuild() {
  setStatus('syncing…');
  const count = await syncFiles(fs.toJSON());
  refreshPreview(els.iframe);
  setStatus(`synced ${count} files`);
}

// Debounced write+rebuild on edit.
let debounce: ReturnType<typeof setTimeout>;
els.editor.addEventListener('input', () => {
  fs.write(current, els.editor.value);
  clearTimeout(debounce);
  debounce = setTimeout(rebuild, 300);
});

els.files.addEventListener('change', () => openFile(els.files.value));

els.theme.textContent = themeLabel(initTheme());
els.theme.addEventListener('click', () => {
  els.theme.textContent = themeLabel(cycleTheme());
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
  // A new SW takes over with an empty FS — re-sync and refresh when that happens.
  onControllerChange(() =>
    rebuild().catch((err) => setStatus(`error: ${err.message}`))
  );
  refreshFileList();
  openFile(fs.has('index.html') ? 'index.html' : fs.list()[0]);
  await rebuild();
}

boot().catch((err) => setStatus(`error: ${err.message}`));
