/// <reference lib="webworker" />
import "./polyfill";
import * as esbuild from "esbuild-wasm/esm/browser.js";
import esbuildWasmUrl from "esbuild-wasm/esbuild.wasm?url";
import { init as initLexer, parse as parseImports } from "es-module-lexer";
import { MemFS, normalizePath } from "./fs";
import { isBare, resolveRelative } from "./resolve";
import type { FileMap } from "./types";

const sw = self as unknown as ServiceWorkerGlobalScope;

const FS_PREFIX = "/__fs/";
const ESM_CDN = "https://esm.sh/";

let fs = new MemFS();

const MIME: Record<string, string> = {
  html: "text/html", js: "text/javascript", mjs: "text/javascript",
  cjs: "text/javascript", ts: "text/javascript", tsx: "text/javascript",
  jsx: "text/javascript", json: "application/json", css: "text/css", svg: "image/svg+xml",
};
const JS_EXTS = new Set(["js", "mjs", "cjs", "ts", "tsx", "jsx"]);

const ext = (p: string) => p.slice(p.lastIndexOf(".") + 1).toLowerCase();
const contentType = (p: string) => MIME[ext(p)] ?? "text/plain";

// ---- esbuild + lexer init (once) ----
let ready: Promise<void> | null = null;
function ensureReady(): Promise<void> {
  if (!ready) {
    ready = Promise.all([
      // worker:false -> run in-thread; SW context has no nested Worker constructor.
      esbuild.initialize({ wasmURL: esbuildWasmUrl, worker: false }),
      initLexer,
    ]).then(() => undefined);
  }
  return ready;
}

// ---- transform cache keyed by content ----
const cache = new Map<string, { src: string; out: string }>();

/** Transform a JS/TS/JSX file to ESM and rewrite its import specifiers. */
async function getModule(path: string): Promise<string | undefined> {
  const src = fs.read(path);
  if (src === undefined) return undefined;

  const cached = cache.get(path);
  if (cached && cached.src === src) return cached.out;

  const loader = ext(path) as "ts" | "tsx" | "jsx" | "js";
  const result = await esbuild.transform(src, {
    loader,
    format: "esm",
    jsx: "automatic",
    sourcemap: "inline",
    sourcefile: path,
  });
  const out = rewriteSpecifiers(path, result.code);
  cache.set(path, { src, out });
  return out;
}

/** Rewrite import specifiers: relative -> /__fs/<resolved>, bare -> esm.sh URL. */
function rewriteSpecifiers(fromPath: string, code: string): string {
  const [imports] = parseImports(code);
  let out = "";
  let last = 0;
  for (const imp of imports) {
    if (imp.n === undefined || imp.s < 0) continue; // dynamic/unanalyzable
    const spec = imp.n;
    // Bare specifiers are left untouched — resolved by the injected import map.
    if (isBare(spec)) continue;
    const resolved = resolveRelative(fromPath, spec, fs);
    const replacement = resolved ? FS_PREFIX + resolved : null;
    if (replacement) {
      out += code.slice(last, imp.s) + replacement;
      last = imp.e;
    }
  }
  return out + code.slice(last);
}

/** Inject a single import map (Safari-friendly) into the preview HTML head. */
async function serveHtml(_path: string, html: string): Promise<Response> {
  const importMap = await buildImportMap();
  const tag = `<script type="importmap">${JSON.stringify({ imports: importMap })}</script>`;
  const injected = html.includes("<head>")
    ? html.replace("<head>", `<head>\n    ${tag}`)
    : tag + html;
  return new Response(injected, { status: 200, headers: { "Content-Type": MIME.html } });
}

/** Build { bareSpecifier -> esm.sh URL } from the transformed output of all modules. */
async function buildImportMap(): Promise<Record<string, string>> {
  const imports: Record<string, string> = {};
  for (const file of fs.list()) {
    if (!JS_EXTS.has(ext(file))) continue;
    const src = fs.read(file);
    if (src === undefined) continue;
    // Lex the transformed (pre-rewrite) code so esbuild-injected imports (jsx-runtime) count.
    await ensureReady();
    const loader = ext(file) as "ts" | "tsx" | "jsx" | "js";
    const { code } = await esbuild.transform(src, { loader, format: "esm", jsx: "automatic" });
    for (const imp of parseImports(code)[0]) {
      if (imp.n && isBare(imp.n)) imports[imp.n] = ESM_CDN + imp.n;
    }
  }
  return imports;
}

// ---- lifecycle ----
sw.addEventListener("install", () => sw.skipWaiting());
sw.addEventListener("activate", (e) => e.waitUntil(sw.clients.claim()));

sw.addEventListener("message", (event) => {
  const data = event.data;
  if (data?.type === "load-files") {
    fs = new MemFS(data.files as FileMap);
    cache.clear();
    event.ports[0]?.postMessage({ type: "files-loaded", count: fs.list().length });
  }
});

sw.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== sw.location.origin || !url.pathname.startsWith(FS_PREFIX)) return;
  event.respondWith(serve(url.pathname.slice(FS_PREFIX.length)));
});

async function serve(rawPath: string): Promise<Response> {
  const path = normalizePath(rawPath) || "index.html";
  const raw = fs.read(path);
  if (raw === undefined) return new Response(`Not found in FS: ${path}`, { status: 404 });

  try {
    if (ext(path) === "html") {
      await ensureReady();
      return await serveHtml(path, raw);
    }
    if (JS_EXTS.has(ext(path))) {
      await ensureReady();
      const code = await getModule(path);
      return new Response(code ?? raw, { status: 200, headers: { "Content-Type": MIME.js } });
    }
    return new Response(raw, { status: 200, headers: { "Content-Type": contentType(path) } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(`/* base-box transform error in ${path}:\n${msg}\n*/`, {
      status: 200,
      headers: { "Content-Type": MIME.js },
    });
  }
}
