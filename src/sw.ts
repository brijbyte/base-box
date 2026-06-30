/// <reference lib="webworker" />
import './polyfill';
import * as Comlink from 'comlink';
import * as esbuild from 'esbuild-wasm/esm/browser.js';
import esbuildWasmUrl from 'esbuild-wasm/esbuild.wasm?url';
import { init as initLexer, parse as parseImports } from 'es-module-lexer';
import initCss, { transform as transformCss } from 'lightningcss-wasm';
import cssWasmUrl from 'lightningcss-wasm/lightningcss_node.wasm?url';
import { MemFS, normalizePath } from './fs';
import { isBare, resolveRelative } from './resolve';
import { parseDeps, buildImports } from './packages';
import { cssModuleToJs, cssToJs } from './css';
import {
  detectAccept,
  planUpdate,
  hmrPreamble,
  compileErrorModule,
  ERROR_RELAY_JS,
  CONSOLE_CAPTURE_JS,
  HMR_CLIENT_JS,
  type ModuleGraph,
} from './hmr';
import { PREVIEW_MSG } from './messages';
import type { HmrMessage, PreviewErrorMessage } from './messages';
import type { SwApi, HotResult } from './preview';
import type { FileMap } from './types';

const sw = self as unknown as ServiceWorkerGlobalScope;

const FS_PREFIX = '/__fs/';
const ESM_CDN = 'https://esm.sh/';

let fs = new MemFS();

const MIME: Record<string, string> = {
  html: 'text/html',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  ts: 'text/javascript',
  tsx: 'text/javascript',
  jsx: 'text/javascript',
  json: 'application/json',
  css: 'text/css',
  svg: 'image/svg+xml',
};
const JS_EXTS = new Set(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx']);

const ext = (p: string) => p.slice(p.lastIndexOf('.') + 1).toLowerCase();
const contentType = (p: string) => MIME[ext(p)] ?? 'text/plain';

// ---- esbuild + lexer init (once) ----
// Key the cache by esbuild version: the wasm and the JS must match exactly, and in
// dev the wasm URL is version-stable, so a bare key would feed a stale wasm to a newer
// esbuild and `initialize` would hang. Versioning auto-invalidates on upgrade.
const WASM_CACHE_PREFIX = 'base-box-wasm-';
const WASM_CACHE = `${WASM_CACHE_PREFIX}${esbuild.version}`;

/**
 * Fetch + compile esbuild.wasm, caching the raw bytes in Cache Storage so the ~12 MB
 * payload survives HTTP-cache eviction and is available offline after first load.
 */
async function loadWasmModule(): Promise<WebAssembly.Module> {
  // Drop caches from older esbuild versions so they don't accumulate.
  for (const name of await caches.keys()) {
    if (name.startsWith(WASM_CACHE_PREFIX) && name !== WASM_CACHE) {
      await caches.delete(name);
    }
  }
  const cache = await caches.open(WASM_CACHE);
  let res = await cache.match(esbuildWasmUrl);
  if (!res) {
    res = await fetch(esbuildWasmUrl);
    if (res.ok) await cache.put(esbuildWasmUrl, res.clone());
  }
  // compile() over arrayBuffer avoids compileStreaming's application/wasm requirement.
  return WebAssembly.compile(await res.arrayBuffer());
}

let ready: Promise<void> | null = null;
function ensureReady(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const wasmModule = await loadWasmModule();
      await Promise.all([
        // worker:false -> run in-thread; SW context has no nested Worker constructor.
        esbuild.initialize({ wasmModule, worker: false }),
        initLexer,
      ]);
    })();
  }
  return ready;
}

// lightningcss is only needed for `.module.css`, so init it lazily (not in ensureReady,
// which runs for every JS/HTML serve). Its wasm is small enough to lean on the HTTP cache
// (assets are `immutable`-cached, see §10) — no Cache-Storage stashing like esbuild.
let cssReady: Promise<void> | null = null;
function ensureCssReady(): Promise<void> {
  if (!cssReady) cssReady = initCss(cssWasmUrl);
  return cssReady;
}

// ---- transform cache keyed by content ----
const cache = new Map<string, { src: string; out: string }>();
const cssCache = new Map<string, { src: string; out: string }>();
// Files whose last transform failed. While non-empty the preview is in a broken state
// (an importer may have failed to *link* against an export-less stub), so the next edit
// must full-reload rather than hot-swap — a CSS boundary update can't relink the importer.
const errored = new Set<string>();

// ---- HMR state ----
const graph: ModuleGraph = new Map(); // importer -> resolved relative deps
const accepts = new Map<string, boolean>(); // module -> is a JS accept boundary
const stamps = new Map<string, number>(); // module -> last-changed clock (import ?t)
let clock = 0; // monotonic; bumped per edit
const stampOf = (p: string) => stamps.get(p) ?? 0;

const isCssModule = (p: string) => p.endsWith('.module.css');

/** Run lightningcss, folding its `loc` into the message so the catch surfaces line/col. */
function runCss(path: string, src: string, cssModules: boolean) {
  try {
    return transformCss({
      filename: path,
      code: new TextEncoder().encode(src),
      cssModules,
    });
  } catch (err) {
    // lightningcss carries the position on `loc`, not in `message` — fold it in so the
    // central catch (which only reads `message`) surfaces line/column to the user.
    const loc = (err as { loc?: { line: number; column: number } }).loc;
    if (err instanceof Error && loc)
      err.message = `${err.message} (${loc.line}:${loc.column})`;
    throw err;
  }
}

/** Compile a CSS-module file to a JS module: scoped CSS injected + class-name map exported. */
function getCssModule(path: string): string {
  const src = fs.read(path) ?? '';
  const cached = cssCache.get(path);
  if (cached && cached.src === src) return cached.out;

  const { code, exports } = runCss(path, src, true);
  const css = new TextDecoder().decode(code);
  const tokens: Record<string, string> = {};
  for (const [orig, exp] of Object.entries(exports ?? {}))
    tokens[orig] = exp.name;

  const out = cssModuleToJs(path, css, tokens);
  cssCache.set(path, { src, out });
  return out;
}

/** Compile a plain `.css` file through lightningcss (nesting, etc.) — no scoping. */
function getCss(path: string): string {
  const src = fs.read(path) ?? '';
  const cached = cssCache.get(path);
  if (cached && cached.src === src) return cached.out;

  const { code } = runCss(path, src, false);
  const out = new TextDecoder().decode(code);
  cssCache.set(path, { src, out });
  return out;
}

/** Transform a JS/TS/JSX file to ESM and rewrite its import specifiers. */
async function getModule(path: string): Promise<string | undefined> {
  const src = fs.read(path);
  if (src === undefined) return undefined;

  const cached = cache.get(path);
  if (cached && cached.src === src) return cached.out;

  accepts.set(path, detectAccept(src));
  const loader = ext(path) as 'ts' | 'tsx' | 'jsx' | 'js';
  const result = await esbuild.transform(src, {
    loader,
    format: 'esm',
    jsx: 'automatic',
    sourcemap: 'inline',
    sourcefile: path,
  });
  // Preamble wires `import.meta.hot`; added after rewrite so it isn't itself rewritten.
  const out = hmrPreamble(path) + rewriteSpecifiers(path, result.code);
  cache.set(path, { src, out });
  return out;
}

/**
 * Rewrite import specifiers: relative -> /__fs/<resolved>?t=<stamp>, bare -> esm.sh URL.
 * The `?t` stamp makes a re-imported module re-fetch deps that changed (ESM caches by
 * URL). Also records the importer -> deps edge into the module graph for HMR propagation.
 */
function rewriteSpecifiers(fromPath: string, code: string): string {
  const [imports] = parseImports(code);
  const deps = new Set<string>();
  let out = '';
  let last = 0;
  for (const imp of imports) {
    if (imp.n === undefined || imp.s < 0) continue; // dynamic/unanalyzable
    const spec = imp.n;
    // Bare specifiers are left untouched — resolved by the injected import map.
    if (isBare(spec)) continue;
    const resolved = resolveRelative(fromPath, spec, fs);
    if (resolved) {
      deps.add(resolved);
      out +=
        code.slice(last, imp.s) +
        `${FS_PREFIX}${resolved}?t=${stampOf(resolved)}`;
      last = imp.e;
    }
  }
  graph.set(fromPath, deps);
  return out + code.slice(last);
}

/** Inject a single import map (Safari-friendly) into the preview HTML head. */
async function serveHtml(_path: string, html: string): Promise<Response> {
  const importMap = await buildImportMap();
  const tag = `<script type="importmap">${JSON.stringify({ imports: importMap })}</script>`;
  // Console capture + relay run first (classic scripts) so console.* is patched before the
  // app's modules execute, and compile errors surface even if the app fails to link.
  const head = `<script>${CONSOLE_CAPTURE_JS}</script>\n    ${tag}\n    <script>${ERROR_RELAY_JS}</script>`;
  const injected = html.includes('<head>')
    ? html.replace('<head>', `<head>\n    ${head}`)
    : head + html;
  return new Response(injected, {
    status: 200,
    headers: { 'Content-Type': MIME.html },
  });
}

/** Broadcast a compile error to every preview window so the host shows the overlay. */
async function broadcastCompileError(
  file: string,
  message: string
): Promise<void> {
  const payload: PreviewErrorMessage = {
    source: PREVIEW_MSG,
    type: 'error',
    kind: 'compile',
    file,
    message,
  };
  for (const client of await sw.clients.matchAll({ type: 'window' }))
    client.postMessage(payload);
}

/**
 * Build { bareSpecifier -> esm.sh URL } from the transformed output of all modules,
 * version-pinned and deduped from package.json (see `packages.ts`).
 */
async function buildImportMap(): Promise<Record<string, string>> {
  const deps = parseDeps(fs.read('package.json'));
  const bare = new Set<string>();
  for (const file of fs.list()) {
    if (!JS_EXTS.has(ext(file))) continue;
    const src = fs.read(file);
    if (src === undefined) continue;
    // Lex the transformed (pre-rewrite) code so esbuild-injected imports (jsx-runtime) count.
    await ensureReady();
    const loader = ext(file) as 'ts' | 'tsx' | 'jsx' | 'js';
    // A syntax error in one file must not break HTML serving; that file's own module
    // fetch surfaces the compile error (the overlay). Just skip it for the import map.
    try {
      const { code } = await esbuild.transform(src, {
        loader,
        format: 'esm',
        jsx: 'automatic',
      });
      for (const imp of parseImports(code)[0]) {
        if (imp.n && isBare(imp.n)) bare.add(imp.n);
      }
    } catch {
      continue;
    }
  }
  return buildImports(bare, deps, ESM_CDN);
}

// ---- lifecycle ----
sw.addEventListener('install', () => sw.skipWaiting());
sw.addEventListener('activate', (e) => e.waitUntil(sw.clients.claim()));

// The RPC the host calls (preview.ts). Comlink owns the SW `message` event via the
// endpoint below; replies route back to the exact requesting client (see swEndpoint).
const api: SwApi = {
  loadFiles(files: FileMap): number {
    fs = new MemFS(files);
    cache.clear();
    cssCache.clear();
    graph.clear();
    accepts.clear();
    stamps.clear();
    return fs.list().length;
  },
  updateFile(path: string, content: string): Promise<HotResult> {
    return handleUpdate(path, content);
  },
};

/**
 * A single-file content edit: update the FS, bump stamps along the dirty chain, then
 * either broadcast a hot update to the preview client(s) or tell the editor to reload.
 */
async function handleUpdate(path: string, content: string): Promise<HotResult> {
  fs.write(path, content);
  cache.clear(); // outputs embed dep stamps; cheapest correct invalidation is clear-all
  cssCache.clear();
  accepts.set(path, detectAccept(content));

  // If the preview is currently broken, a hot-swap can't relink the failed importer —
  // force a full reload so the whole graph re-evaluates against the fixed file.
  const wasBroken = errored.size > 0;
  const plan = planUpdate(path, graph, accepts);
  const { boundaries, dirty } = plan;
  const reload = plan.reload || wasBroken;
  clock++;
  for (const p of dirty) stamps.set(p, clock);

  if (!reload) {
    const payload: HmrMessage = {
      type: 'hmr',
      boundaries: boundaries.map((p) => ({
        path: p,
        url: `${FS_PREFIX}${p}?t=${clock}`,
      })),
    };
    for (const client of await sw.clients.matchAll({ type: 'window' }))
      client.postMessage(payload);
  }
  return { reload, boundaries };
}

// Comlink endpoint that preserves the two robustness properties of the old hand-rolled
// protocol: (1) reply to the *exact* client that sent each request (keyed by Comlink's
// message id) — works even before the page is controlled; (2) hold the worker alive with
// waitUntil from request-receipt until the reply is posted.
const replyTo = new Map<string | number, Client>();
const keepAlive = new Map<string | number, () => void>();

const swEndpoint: Comlink.Endpoint = {
  addEventListener: (_type, listener) => {
    sw.addEventListener('message', (event) => {
      const id = (event.data as { id?: string | number })?.id;
      if (id != null && event.source) {
        replyTo.set(id, event.source as Client);
        event.waitUntil(
          new Promise<void>((resolve) => keepAlive.set(id, resolve))
        );
      }
      (listener as EventListener)(event as unknown as Event);
    });
  },
  removeEventListener: () => {},
  postMessage: (message, transfer) => {
    const id = (message as { id?: string | number })?.id;
    if (id == null) return;
    const client = replyTo.get(id);
    replyTo.delete(id);
    keepAlive.get(id)?.();
    keepAlive.delete(id);
    client?.postMessage(message, (transfer ?? []) as Transferable[]);
  },
};

Comlink.expose(api, swEndpoint);

sw.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== sw.location.origin || !url.pathname.startsWith(FS_PREFIX))
    return;
  // `destination` distinguishes a stylesheet `<link>` ('style') from a JS-graph
  // `import './x.css'` ('script'/empty) — see the plain-CSS branch in `serve`.
  event.respondWith(
    serve(url.pathname.slice(FS_PREFIX.length), event.request.destination)
  );
});

async function serve(rawPath: string, destination = ''): Promise<Response> {
  const path = normalizePath(rawPath) || 'index.html';
  // Virtual module: the HMR client runtime (not a real FS file).
  if (path === '@hmr')
    return new Response(HMR_CLIENT_JS, {
      status: 200,
      headers: { 'Content-Type': MIME.js },
    });
  const raw = fs.read(path);
  if (raw === undefined)
    return new Response(`Not found in FS: ${path}`, { status: 404 });

  try {
    if (ext(path) === 'html') {
      await ensureReady();
      return await serveHtml(path, raw);
    }
    if (isCssModule(path)) {
      await ensureCssReady();
      const out = getCssModule(path);
      errored.delete(path);
      return new Response(out, {
        status: 200,
        headers: { 'Content-Type': MIME.js },
      });
    }
    // Plain `.css`: run through lightningcss like CSS modules (nesting, etc.). A
    // `<link rel=stylesheet>` request (destination 'style') gets text/css; a module-graph
    // `import './x.css'` gets a side-effect JS module that injects the compiled CSS.
    if (ext(path) === 'css') {
      await ensureCssReady();
      const css = getCss(path);
      errored.delete(path);
      if (destination === 'style')
        return new Response(css, {
          status: 200,
          headers: { 'Content-Type': MIME.css },
        });
      return new Response(cssToJs(path, css), {
        status: 200,
        headers: { 'Content-Type': MIME.js },
      });
    }
    if (JS_EXTS.has(ext(path))) {
      await ensureReady();
      const code = await getModule(path);
      errored.delete(path);
      return new Response(code ?? raw, {
        status: 200,
        headers: { 'Content-Type': MIME.js },
      });
    }
    return new Response(raw, {
      status: 200,
      headers: { 'Content-Type': contentType(path) },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Broadcast (reaches the host even if the stub never executes), and return a module
    // that also reports + throws for the case where it does run as the entry.
    errored.add(path);
    void broadcastCompileError(path, msg);
    return new Response(compileErrorModule(path, msg), {
      status: 200,
      headers: { 'Content-Type': MIME.js },
    });
  }
}
