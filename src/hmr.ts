// HMR support: module graph + propagation (SW side) and the client runtime (iframe side).
// Modeled on Vite dev HMR — re-import accept boundaries instead of reloading the page.
import { PREVIEW_MSG } from './messages';

/** importer path -> set of its resolved relative deps (built during rewriteSpecifiers). */
export type ModuleGraph = Map<string, Set<string>>;

const isCss = (p: string) => p.endsWith('.css');

/** A module is a JS accept boundary if it calls `import.meta.hot.accept(`. */
export function detectAccept(src: string): boolean {
  return /import\.meta\.hot\s*\.\s*accept\s*\(/.test(src);
}

export type UpdatePlan = {
  /** No accept boundary found → fall back to a full reload. */
  reload: boolean;
  /** Modules whose accept handler should run (re-imported by the client). */
  boundaries: string[];
  /** Every module from the change up to the boundaries (stamps bumped → re-fetched fresh). */
  dirty: string[];
};

/**
 * Walk importers of `changed` until each path hits an accept boundary; if any path
 * reaches a root (a module with no importers, e.g. the entry) without one, full-reload.
 * CSS files are implicitly self-accepting (our `<style>` injector swaps in place).
 */
export function planUpdate(
  changed: string,
  graph: ModuleGraph,
  accepts: Map<string, boolean>
): UpdatePlan {
  const reverse = new Map<string, Set<string>>();
  for (const [from, deps] of graph) {
    for (const dep of deps) {
      (reverse.get(dep) ?? reverse.set(dep, new Set()).get(dep)!).add(from);
    }
  }

  const boundaries = new Set<string>();
  const dirty = new Set<string>();
  const seen = new Set<string>();
  let reload = false;

  const visit = (path: string) => {
    if (reload) return;
    dirty.add(path);
    if (isCss(path) || accepts.get(path)) {
      boundaries.add(path);
      return;
    }
    const importers = reverse.get(path);
    if (!importers || importers.size === 0) {
      reload = true; // reached a root with no boundary
      return;
    }
    for (const imp of importers) {
      if (seen.has(imp)) continue;
      seen.add(imp);
      visit(imp);
      if (reload) return;
    }
  };

  visit(changed);
  // No reload signal but also no boundary (e.g. an import cycle) → be safe, reload.
  if (!reload && boundaries.size === 0) reload = true;

  return { reload, boundaries: [...boundaries], dirty: [...dirty] };
}

/** One-line preamble prepended to every transformed JS module to wire `import.meta.hot`. */
export function hmrPreamble(path: string): string {
  return `import {createHotContext as __bbhot} from "/__fs/@hmr";import.meta.hot=__bbhot(${JSON.stringify(path)});\n`;
}

/**
 * Always-present relay injected into the served HTML <head>, before the app's module
 * scripts. It forwards compile-error messages the SW broadcasts (see sw.ts) up to the
 * host. This is the *reliable* path: when a file fails to compile its stub has no exports,
 * so any importer fails to *link* — the stub's own body (and @hmr) never run. This classic
 * script runs regardless of the module graph, so the error still reaches the overlay.
 */
export const ERROR_RELAY_JS = `(function(){
  if (!navigator.serviceWorker) return;
  navigator.serviceWorker.addEventListener('message', function(e){
    var d = e && e.data;
    if (d && d.source === ${JSON.stringify(PREVIEW_MSG)} && d.type === 'error')
      (window.parent || window).postMessage(d, '*');
  });
})();`;

/**
 * Classic script injected into the preview <head> (before the app's modules) that patches
 * `console.*` to forward each call to the host's console panel while still logging natively.
 * Args are serialized here — the iframe holds the live objects — and posted as a string.
 * Uncaught errors / rejections are mirrored as `error` entries too, matching devtools.
 */
export const CONSOLE_CAPTURE_JS = `(function(){
  var SRC = ${JSON.stringify(PREVIEW_MSG)};
  var host = window.parent || window;
  function fmt(a){
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.stack || (a.name + ': ' + a.message);
    if (typeof a === 'function') return '[Function ' + (a.name || 'anonymous') + ']';
    if (typeof a === 'undefined') return 'undefined';
    if (typeof a === 'bigint') return a.toString() + 'n';
    try {
      var seen = new WeakSet();
      var out = JSON.stringify(a, function(k, v){
        if (typeof v === 'bigint') return v.toString() + 'n';
        if (typeof v === 'function') return '[Function ' + (v.name || 'anonymous') + ']';
        if (typeof v === 'object' && v !== null){ if (seen.has(v)) return '[Circular]'; seen.add(v); }
        return v;
      }, 2);
      return out === undefined ? String(a) : out;
    } catch(e){ try { return String(a); } catch(_){ return '[Unserializable]'; } }
  }
  function send(level, args){
    var text;
    try { text = Array.prototype.map.call(args, fmt).join(' '); }
    catch(e){ text = '[console serialization failed]'; }
    try { host.postMessage({ source: SRC, type: 'console', level: level, text: text }, '*'); } catch(e){}
  }
  ['log','info','warn','error','debug'].forEach(function(level){
    var orig = console[level];
    console[level] = function(){ send(level, arguments); if (orig) return orig.apply(console, arguments); };
  });
  window.addEventListener('error', function(e){
    var m = (e.error && (e.error.stack || e.error.message)) || e.message || String(e);
    if (typeof m === 'string' && m.indexOf('[base-box]') === 0) return; // compile stub already reported
    send('error', [m]);
  });
  window.addEventListener('unhandledrejection', function(e){
    var r = e.reason;
    send('error', ['Uncaught (in promise) ' + ((r && (r.stack || r.message)) || String(r))]);
  });
})();`;

/**
 * A stand-in module returned when esbuild/lightningcss fail to transform a file: it posts
 * the compile error to the host (overlay) then throws to halt. The thrown message starts
 * with `[base-box]` so the runtime error handler ignores it (no double report). The SW also
 * broadcasts the same error (relayed by ERROR_RELAY_JS) for the case where this body never
 * runs because an importer failed to link against the export-less stub.
 */
export function compileErrorModule(file: string, message: string): string {
  const payload = JSON.stringify({
    source: PREVIEW_MSG,
    type: 'error',
    kind: 'compile',
    file,
    message,
  });
  const thrown = JSON.stringify(`[base-box] ${file}\n${message}`);
  return `(window.parent||window).postMessage(${payload},"*");throw new Error(${thrown});`;
}

/**
 * The HMR client runtime, served at /__fs/@hmr. It owns `import.meta.hot` contexts and
 * applies `hmr` messages from the SW: re-import each boundary and hand the new module to
 * the *old* module's accept callback (Vite semantics), or full-reload when told to.
 */
export const HMR_CLIENT_JS = `
const registry = new Map();
const PREVIEW_MSG = ${JSON.stringify(PREVIEW_MSG)};

// Report runtime errors to the host so it can show the preview error overlay.
function report(kind, message, stack, file) {
  (window.parent || window).postMessage({ source: PREVIEW_MSG, type: 'error', kind, message, stack, file }, '*');
}
window.addEventListener('error', (e) => {
  const m = (e.error && e.error.message) || e.message || String(e);
  if (typeof m === 'string' && m.indexOf('[base-box]') === 0) return; // compile stub already reported
  report('runtime', m, e.error && e.error.stack, e.filename);
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  report('runtime', (r && r.message) || String(r), r && r.stack);
});

export function createHotContext(id) {
  let mod = registry.get(id);
  if (!mod) { mod = { cb: null, dispose: null, data: {} }; registry.set(id, mod); }
  mod.cb = null; mod.dispose = null; // re-eval re-registers fresh handlers
  return {
    accept(cb) { mod.cb = typeof cb === 'function' ? cb : () => {}; },
    dispose(cb) { mod.dispose = cb; },
    invalidate() { location.reload(); },
    get data() { return mod.data; },
  };
}

async function apply(b) {
  // CSS pulled in via <link rel=stylesheet>: swap the link's href in place (it already
  // carries a ?t cache-buster) instead of re-importing the JS injector, which would add a
  // duplicate inline <style> on top of the still-present <link>.
  const want = new URL(b.url, location.href).pathname;
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
    if (new URL(link.href, location.href).pathname === want) {
      link.href = new URL(b.url, location.href).href;
      return;
    }
  }
  const mod = registry.get(b.path);
  const cb = mod && mod.cb;          // the OLD module's accept callback
  const dispose = mod && mod.dispose;
  try {
    if (dispose) dispose(mod.data);
    const next = await import(b.url); // new URL (?t) → fresh module eval (CSS self-injects)
    if (cb) cb(next);
  } catch (err) {
    console.error('[base-box hmr] update failed for ' + b.path + ', reloading', err);
    location.reload();
  }
}

navigator.serviceWorker.addEventListener('message', (e) => {
  const msg = e.data;
  if (!msg || msg.type !== 'hmr') return;
  if (msg.reload) { location.reload(); return; }
  msg.boundaries.forEach(apply);
});
`;
