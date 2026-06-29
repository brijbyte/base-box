// HMR support: module graph + propagation (SW side) and the client runtime (iframe side).
// Modeled on Vite dev HMR — re-import accept boundaries instead of reloading the page.

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
 * The HMR client runtime, served at /__fs/@hmr. It owns `import.meta.hot` contexts and
 * applies `hmr` messages from the SW: re-import each boundary and hand the new module to
 * the *old* module's accept callback (Vite semantics), or full-reload when told to.
 */
export const HMR_CLIENT_JS = `
const registry = new Map();

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
