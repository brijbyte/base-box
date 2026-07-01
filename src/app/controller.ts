// The framework-agnostic engine controller. All non-markup logic from the old
// main.ts lives here: the in-memory FS, lazy language servers, the CodeMirror
// editor + @pierre/trees panel (mounted into React-owned ref divs), preview
// wiring, and the theme axes. React reads a small reactive snapshot via
// `subscribe`/`getSnapshot` (useSyncExternalStore); the hot paths (edits, tree
// mutations, console output) stay imperative — exactly as the original did.
import { MemFS } from '../fs';
import { encodeFiles } from '../codec';
import { SAMPLE, VUE_SAMPLE } from '../sample';
import { compileSfc, isVue, vueErrorModule } from '../vue';
import type { FileMap } from '../types';
import {
  registerServiceWorker,
  syncFiles,
  updateFile,
  refreshPreview,
  onControllerChange,
} from '../preview';
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
  type Mode,
  type Appearance,
} from '../theme';
import { downloadZip } from '../zip';
import {
  onPreviewError,
  onPreviewConsole,
  type ConsoleLevel,
} from '../messages';
import { createEditor, type Editor, type EditorStatus } from '../editor';
import { createFileTree, type FileTreePanel } from '../filetree';
import type { LspClient } from '../lsp/bridge'; // type-only: no runtime import

/** The reactive slice React renders from (via useSyncExternalStore). */
export interface Snapshot {
  status: string;
  editorStatus: EditorStatus | null;
  filename: string;
  /** Skeleton overlays hide once the tree/editor are first mounted + opened. */
  booted: boolean;
  previewTitle: string;
  /** Preview loading overlay: shown/hidden, its label, and error styling. */
  preview: { visible: boolean; label: string; error: boolean };
  previewError: { title: string; message: string } | null;
  counts: { error: number; warn: number };
  mode: Mode;
  appearance: Appearance;
  colorTheme: string;
}

const extOf = (p: string) => p.slice(p.lastIndexOf('.') + 1).toLowerCase();
const TS_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue']);
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

const TEMPLATES: Record<string, FileMap> = { react: SAMPLE, vue: VUE_SAMPLE };

// Turn SW URLs (origin + /__fs/ + ?t stamps) into the project-relative FS path.
const FS_URL_RE = new RegExp(
  `${location.origin}/__fs/([^?\\s)]*)(\\?t=\\d+)?`,
  'g'
);
const toRelativePaths = (s: string) => s.replace(FS_URL_RE, '$1');

export class Controller {
  readonly fs: MemFS;
  private current = '';
  private editor: Editor | null = null;
  private panel: FileTreePanel | null = null;
  private treeMount: HTMLElement | null = null;
  private iframe: HTMLIFrameElement | null = null;
  private consoleLog: HTMLElement | null = null;

  private tsLsp = lazyLsp(() =>
    import('../lsp/client').then(({ createLspClient }) =>
      createLspClient(this.fs.toJSON())
    )
  );
  private cssLsp = lazyLsp(() =>
    import('../lsp/css-client').then(({ createCssLspClient }) =>
      createCssLspClient()
    )
  );

  // --- Store ---
  private snapshot: Snapshot;
  private listeners = new Set<() => void>();
  private notifyScheduled = false;

  // --- Editor debounce + preview overlay state ---
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private previewArmed = false;

  // --- Console coalescing ---
  private lastRow: HTMLElement | null = null;
  private lastKey = '';

  constructor(files: FileMap) {
    this.fs = new MemFS(files);

    // Prefer the file named in the URL (?file=) so a refresh re-selects it.
    const fromUrl = new URLSearchParams(location.search).get('file');
    this.current =
      fromUrl && this.fs.has(fromUrl)
        ? fromUrl
        : this.fs.has('index.html')
          ? 'index.html'
          : this.firstFile();

    // Apply persisted theming (the anti-FOUC inline script already set the attrs).
    initTheme();
    const mode = getMode();
    const appearance = effectiveAppearance();
    this.snapshot = {
      status: '',
      editorStatus: null,
      filename: this.current || '(no file)',
      booted: false,
      previewTitle: 'Preview',
      preview: { visible: true, label: 'Starting…', error: false },
      previewError: null,
      counts: { error: 0, warn: 0 },
      mode,
      appearance,
      colorTheme: getColorTheme(appearance),
    };

    // Engine subscriptions: single instance, never torn down (no leak).
    onPreviewError((d) => {
      // WebKit stacks omit the message line, so show the message and append the stack.
      const msg = d.message || 'Unknown error';
      const body =
        d.stack && !d.stack.includes(msg)
          ? `${msg}\n\n${d.stack}`
          : d.stack || msg;
      this.showPreviewError(d.kind, body, d.file);
    });
    onPreviewConsole((d) => this.appendConsole(d.level, d.text));
    onSystemAppearanceChange(() => {
      if (getMode() !== 'system') return;
      const a = effectiveAppearance();
      void loadTheme(a, getColorTheme(a));
      this.setState({ appearance: a, colorTheme: getColorTheme(a) });
    });
  }

  // ── Store surface ───────────────────────────────────────────────────────
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = (): Snapshot => this.snapshot;

  private setState(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    requestAnimationFrame(() => {
      this.notifyScheduled = false;
      this.listeners.forEach((l) => l());
    });
  }

  private setStatus(msg: string) {
    this.setState({ status: msg });
  }

  private firstFile() {
    return this.fs.list()[0] ?? '';
  }

  // ── The language server (if any) that handles `path`, by extension. ───────
  private lspFor(path: string) {
    const e = extOf(path);
    if (TS_EXTS.has(e)) return this.tsLsp;
    if (CSS_EXTS.has(e)) return this.cssLsp;
    return null;
  }

  // ── Mount points (called from React layout effects) ───────────────────────
  mountEditor(el: HTMLElement): () => void {
    const editor = createEditor(
      el,
      (value) => {
        if (!this.current) return;
        this.fs.write(this.current, value);
        const path = this.current;
        clearTimeout(this.debounce);
        this.debounce = setTimeout(() => {
          // Keep each running LSP's snapshot current so cross-file imports see edits.
          const files = this.fs.toJSON();
          this.tsLsp.instance()?.sync(files);
          this.cssLsp.instance()?.sync(files);
          void this.hotUpdate(path, value);
        }, 300);
      },
      {
        lspSupport: (path) => {
          const lsp = this.lspFor(path);
          return lsp ? lsp.ensure().then((c) => c.support(path)) : [];
        },
        onStatus: (s) => this.setState({ editorStatus: s }),
      }
    );
    this.editor = editor;
    // Re-apply the current file so a StrictMode remount restores content.
    if (this.current)
      editor.setFile(this.current, this.fs.read(this.current) ?? '');
    return () => {
      editor.destroy();
      if (this.editor === editor) this.editor = null;
    };
  }

  mountTree(el: HTMLElement): () => void {
    this.treeMount = el;
    this.panel = this.createTree(el, this.current);
    return () => {
      this.panel?.destroy();
      this.panel = null;
      if (this.treeMount === el) this.treeMount = null;
    };
  }

  private createTree(el: HTMLElement, selected: string): FileTreePanel {
    return createFileTree(el, this.fs.list(), selected || null, {
      onOpen: (p) => this.openFile(p),
      onAdd: (p) => this.onAdd(p),
      onRemove: (p) => this.onRemove(p),
      onMove: (from, to) => this.onMove(from, to),
    });
  }

  attachIframe(el: HTMLIFrameElement): () => void {
    this.iframe = el;
    const onLoad = () => {
      this.syncPreviewTitle();
      if (!this.previewArmed) return;
      this.previewArmed = false;
      this.setState({ preview: { ...this.snapshot.preview, visible: false } });
    };
    el.addEventListener('load', onLoad);
    return () => {
      el.removeEventListener('load', onLoad);
      if (this.iframe === el) this.iframe = null;
    };
  }

  setConsoleLog(el: HTMLElement | null) {
    this.consoleLog = el;
  }

  // ── One-shot boot (guarded by the caller via a ref) ───────────────────────
  async boot() {
    this.setState({ booted: true });
    this.setPreviewLabel('Starting service worker…');
    this.setStatus('registering service worker…');
    await registerServiceWorker();
    onControllerChange(() =>
      this.rebuild().catch((err) => this.setStatus(`error: ${err.message}`))
    );
    await this.rebuild();
  }

  // ── File open / URL sync ──────────────────────────────────────────────────
  private openFile(path: string) {
    this.current = path;
    this.setState({ filename: path || '(no file)' });
    this.editor?.setFile(path, this.fs.read(path) ?? '');
    this.syncUrlFile(path);
  }

  focusCurrent(path: string) {
    // Called by the tree's selection; keep editor + panel in sync.
    this.openFile(path);
  }

  private syncUrlFile(path: string) {
    const url = new URL(location.href);
    if (path) url.searchParams.set('file', path);
    else url.searchParams.delete('file');
    history.replaceState(null, '', url);
  }

  // ── Rebuild / sync to the service worker ─────────────────────────────────
  /** Precompile every .vue to JS (the SW stays Vue-unaware). A failed SFC becomes a
   *  throwing stub + a preview-error overlay, so one bad file doesn't break the sync. */
  private async toSwFiles(files: FileMap): Promise<FileMap> {
    const out: FileMap = {};
    for (const [path, content] of Object.entries(files)) {
      if (!isVue(path)) {
        out[path] = content;
        continue;
      }
      try {
        out[path] = await compileSfc(path, content);
      } catch (err) {
        const msg = (err as Error).message;
        out[path] = vueErrorModule(path, msg);
        this.showPreviewError('compile', msg, path);
      }
    }
    return out;
  }

  private async rebuild() {
    this.setStatus('syncing…');
    const files = this.fs.toJSON();
    this.tsLsp.instance()?.sync(files);
    this.cssLsp.instance()?.sync(files);
    const count = await syncFiles(await this.toSwFiles(files));
    this.reloadPreview('Compiling…');
    this.setStatus(`synced ${count} files`);
  }

  // Try to hot-swap the changed module; fall back to a full reload when the SW says so.
  private async hotUpdate(path: string, content: string) {
    this.setStatus('updating…');
    this.clearPreviewError();
    try {
      const swContent = isVue(path) ? await compileSfc(path, content) : content;
      const { reload, boundaries } = await updateFile(path, swContent);
      if (reload) {
        this.reloadPreview('Reloading…');
        this.setStatus(`reloaded (${path})`);
      } else {
        this.setStatus(`hot-updated ${boundaries.join(', ') || path}`);
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (isVue(path)) this.showPreviewError('compile', msg, path);
      this.setStatus(`error: ${msg}`);
    }
  }

  // ── FS structural helpers (mirror tree mutations) ─────────────────────────
  private fsRemove(path: string) {
    for (const f of this.fs.list()) {
      if (f === path || f.startsWith(path + '/')) this.fs.delete(f);
    }
  }
  private fsMove(from: string, to: string) {
    for (const f of this.fs.list()) {
      if (f === from || f.startsWith(from + '/')) {
        const dest = to + f.slice(from.length);
        this.fs.write(dest, this.fs.read(f) ?? '');
        this.fs.delete(f);
      }
    }
  }

  private onAdd(path: string) {
    if (!this.fs.has(path)) this.fs.write(path, '');
    this.openFile(path);
    void this.rebuild();
  }
  private onRemove(path: string) {
    this.fsRemove(path);
    if (this.current === path || this.current.startsWith(path + '/')) {
      const next = this.firstFile();
      this.openFile(next || '');
    }
    void this.rebuild();
  }
  private onMove(from: string, to: string) {
    this.fsMove(from, to);
    if (this.current === from || this.current.startsWith(from + '/')) {
      this.openFile(to + this.current.slice(from.length));
    }
    void this.rebuild();
  }

  // ── Toolbar actions (proxied to the tree panel) ──────────────────────────
  newFile() {
    this.panel?.startCreate();
  }
  rename() {
    const p = this.panel?.selected() ?? this.current;
    if (p) this.panel?.startRename(p);
  }
  remove() {
    const p = this.panel?.selected() ?? this.current;
    if (p) this.panel?.remove(p);
  }
  download() {
    downloadZip('base-box', this.fs.toJSON());
    this.setStatus('downloaded base-box.zip');
  }
  async share() {
    const u = new URL(`${location.origin}${location.pathname}`);
    u.searchParams.set('files', await encodeFiles(this.fs.toJSON()));
    if (this.current) u.searchParams.set('file', this.current);
    const url = u.toString();
    await navigator.clipboard?.writeText(url).catch(() => {});
    history.replaceState(null, '', url);
    this.setStatus('share URL copied');
  }

  // ── Template loading ─────────────────────────────────────────────────────
  async loadTemplate(id: string) {
    const files = TEMPLATES[id];
    if (files) await this.loadProject(files);
  }

  /** Replace the whole project: reset the FS, rebuild the tree, re-sync. */
  private async loadProject(files: FileMap) {
    for (const f of this.fs.list()) this.fs.delete(f);
    for (const [p, c] of Object.entries(files)) this.fs.write(p, c);
    this.current = this.fs.has('index.html') ? 'index.html' : this.firstFile();
    // Tear down the old tree DOM before re-mounting (createFileTree appends).
    if (this.treeMount) {
      this.treeMount.replaceChildren();
      this.panel = this.createTree(this.treeMount, this.current);
    }
    this.openFile(this.current);
    const url = new URL(location.href);
    url.searchParams.delete('files');
    history.replaceState(null, '', url);
    await this.rebuild();
  }

  // ── Theme actions ────────────────────────────────────────────────────────
  async setMode(mode: Mode) {
    // Preload the theme the new mode will make effective so the switch doesn't flash.
    const appearance = appearanceForMode(mode);
    await loadTheme(appearance, getColorTheme(appearance));
    setMode(mode);
    const a = effectiveAppearance();
    this.setState({ mode, appearance: a, colorTheme: getColorTheme(a) });
  }
  setColorTheme(id: string) {
    const appearance = effectiveAppearance();
    void setColorTheme(appearance, id);
    this.setState({ colorTheme: id });
  }

  // ── Preview overlay + error ───────────────────────────────────────────────
  private syncPreviewTitle() {
    const title = this.iframe?.contentDocument?.title?.trim();
    this.setState({ previewTitle: title || 'Preview' });
  }

  private setPreviewLabel(label: string) {
    this.setState({ preview: { visible: true, label, error: false } });
  }

  /** Show the overlay, then (re)load the iframe; the `load` handler hides it. */
  reloadPreview(label = 'Loading preview…') {
    this.clearPreviewError();
    this.clearConsole();
    this.setPreviewLabel(label);
    this.previewArmed = true;
    if (this.iframe) refreshPreview(this.iframe);
  }

  clearPreviewError() {
    this.setState({ previewError: null });
  }

  private showPreviewError(kind: string, message: string, file?: string) {
    const title =
      kind === 'compile'
        ? `Compile error${file ? ` — ${toRelativePaths(file)}` : ''}`
        : 'Runtime error';
    this.setState({
      previewError: { title, message: toRelativePaths(message) },
    });
  }

  bootError(msg: string) {
    this.previewArmed = false;
    this.setState({ preview: { visible: true, label: msg, error: true } });
  }

  // ── Console panel (imperative DOM sink; counts go through the store) ───────
  private clearConsole() {
    this.consoleLog?.replaceChildren();
    this.lastRow = null;
    this.lastKey = '';
    this.setState({ counts: { error: 0, warn: 0 } });
  }

  clearConsoleFromUser = () => this.clearConsole();

  private appendConsole(level: ConsoleLevel, text: string) {
    const log = this.consoleLog;
    if (!log) return;
    if (level === 'error' || level === 'warn') {
      const counts = { ...this.snapshot.counts };
      counts[level]++;
      this.setState({ counts });
    }

    // Coalesce identical consecutive lines (devtools-style) into a repeat badge.
    const key = `${level} ${text}`;
    if (key === this.lastKey && this.lastRow) {
      let badge =
        this.lastRow.querySelector<HTMLSpanElement>('.console-repeat');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'console-repeat';
        badge.textContent = '1';
        this.lastRow.prepend(badge);
      }
      badge.textContent = String(Number(badge.textContent) + 1);
      return;
    }

    const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
    const row = document.createElement('div');
    row.className = 'console-row';
    row.dataset.level = level;
    const body = document.createElement('span');
    body.className = 'console-text';
    body.textContent = text;
    row.append(body);
    log.append(row);
    this.lastRow = row;
    this.lastKey = key;
    if (atBottom) log.scrollTop = log.scrollHeight;
  }
}
