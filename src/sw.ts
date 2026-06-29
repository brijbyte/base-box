/// <reference lib="webworker" />
import './polyfill';
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
  HMR_CLIENT_JS,
  type ModuleGraph,
} from './hmr';
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

// ---- HMR state ----
const graph: ModuleGraph = new Map(); // importer -> resolved relative deps
const accepts = new Map<string, boolean>(); // module -> is a JS accept boundary
const stamps = new Map<string, number>(); // module -> last-changed clock (import ?t)
let clock = 0; // monotonic; bumped per edit
const stampOf = (p: string) => stamps.get(p) ?? 0;

const isCssModule = (p: string) => p.endsWith('.module.css');

/** Compile a CSS-module file to a JS module: scoped CSS injected + class-name map exported. */
function getCssModule(path: string): string {
  const src = fs.read(path) ?? '';
  const cached = cssCache.get(path);
  if (cached && cached.src === src) return cached.out;

  const { code, exports } = transformCss({
    filename: path,
    code: new TextEncoder().encode(src),
    cssModules: true,
  });
  const css = new TextDecoder().decode(code);
  const tokens: Record<string, string> = {};
  for (const [orig, exp] of Object.entries(exports ?? {}))
    tokens[orig] = exp.name;

  const out = cssModuleToJs(path, css, tokens);
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
  const injected = html.includes('<head>')
    ? html.replace('<head>', `<head>\n    ${tag}`)
    : tag + html;
  return new Response(injected, {
    status: 200,
    headers: { 'Content-Type': MIME.html },
  });
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
    const { code } = await esbuild.transform(src, {
      loader,
      format: 'esm',
      jsx: 'automatic',
    });
    for (const imp of parseImports(code)[0]) {
      if (imp.n && isBare(imp.n)) bare.add(imp.n);
    }
  }
  return buildImports(bare, deps, ESM_CDN);
}

// ---- lifecycle ----
sw.addEventListener('install', () => sw.skipWaiting());
sw.addEventListener('activate', (e) => e.waitUntil(sw.clients.claim()));

sw.addEventListener('message', (event) => {
  const data = event.data;
  if (data?.type === 'load-files') {
    fs = new MemFS(data.files as FileMap);
    cache.clear();
    cssCache.clear();
    graph.clear();
    accepts.clear();
    stamps.clear();
    event.ports[0]?.postMessage({
      type: 'files-loaded',
      count: fs.list().length,
    });
  } else if (data?.type === 'update-file') {
    event.waitUntil(
      handleUpdate(data.path as string, data.content as string, event)
    );
  }
});

/**
 * A single-file content edit: update the FS, bump stamps along the dirty chain, then
 * either broadcast a hot update to the preview client(s) or tell the editor to reload.
 */
async function handleUpdate(
  path: string,
  content: string,
  event: ExtendableMessageEvent
): Promise<void> {
  fs.write(path, content);
  cache.clear(); // outputs embed dep stamps; cheapest correct invalidation is clear-all
  cssCache.clear();
  accepts.set(path, detectAccept(content));

  const { reload, boundaries, dirty } = planUpdate(path, graph, accepts);
  clock++;
  for (const p of dirty) stamps.set(p, clock);

  if (!reload) {
    const payload = {
      type: 'hmr',
      boundaries: boundaries.map((p) => ({
        path: p,
        url: `${FS_PREFIX}${p}?t=${clock}`,
      })),
    };
    for (const client of await sw.clients.matchAll({ type: 'window' }))
      client.postMessage(payload);
  }
  event.ports[0]?.postMessage({ type: 'file-updated', reload, boundaries });
}

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
      return new Response(getCssModule(path), {
        status: 200,
        headers: { 'Content-Type': MIME.js },
      });
    }
    // Plain `.css` imported in a module graph (not via `<link rel=stylesheet>`):
    // serve a side-effect JS module that injects the CSS. `<link>` requests
    // (destination 'style') fall through to the generic `text/css` branch.
    if (ext(path) === 'css' && destination !== 'style') {
      return new Response(cssToJs(path, raw), {
        status: 200,
        headers: { 'Content-Type': MIME.js },
      });
    }
    if (JS_EXTS.has(ext(path))) {
      await ensureReady();
      const code = await getModule(path);
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
    return new Response(`/* base-box transform error in ${path}:\n${msg}\n*/`, {
      status: 200,
      headers: { 'Content-Type': MIME.js },
    });
  }
}
