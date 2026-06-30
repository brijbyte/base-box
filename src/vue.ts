// Main-thread Vue SFC compiler. @vue/compiler-sfc is heavy (~600 KB), so it's loaded lazily
// — only when a project actually contains .vue files — and kept OUT of the service-worker
// bundle (service workers can't dynamic-import, so anything bundled there ships eagerly).
// The SW then treats the compiled output as an ordinary JS module (esbuild + import rewrite).
import type { BindingMetadata } from '@vue/compiler-sfc';

type Sfc = typeof import('@vue/compiler-sfc');
let mod: Promise<Sfc> | null = null;
const load = (): Promise<Sfc> => (mod ??= import('@vue/compiler-sfc'));

// Content-keyed cache so an unchanged file isn't recompiled on every full sync.
const cache = new Map<string, { src: string; out: string }>();

/** Deterministic short id for scoped-CSS (`data-v-<id>`), stable across rebuilds. */
function hashId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36).padStart(7, '0');
}

/** Inject `css` into one keyed <style> node; wrapped in a block so its consts can't clash. */
function styleInject(key: string, css: string): string {
  return [
    '{',
    `  const __css = ${JSON.stringify(css)};`,
    `  const __id = ${JSON.stringify(key)};`,
    `  let __s = document.querySelector('style[data-base-box="' + __id + '"]');`,
    `  if (!__s) { __s = document.createElement('style'); __s.setAttribute('data-base-box', __id); document.head.appendChild(__s); }`,
    `  __s.textContent = __css;`,
    '}',
  ].join('\n');
}

/** Whether a path is a Vue SFC. */
export const isVue = (p: string): boolean => p.toLowerCase().endsWith('.vue');

/**
 * Compile an SFC to an ESM string (still possibly containing TS — the SW's esbuild pass
 * strips it). Throws on compile errors so the caller can surface the preview overlay.
 */
export async function compileSfc(path: string, src: string): Promise<string> {
  const hit = cache.get(path);
  if (hit && hit.src === src) return hit.out;

  const {
    parse,
    compileScript,
    compileTemplate,
    compileStyle,
    rewriteDefault,
  } = await load();
  const { descriptor, errors } = parse(src, { filename: path });
  if (errors.length) throw new Error(errors[0].message ?? String(errors[0]));

  const id = hashId(path);
  const hasScoped = descriptor.styles.some((s) => s.scoped);
  const isTs =
    (descriptor.script?.lang ?? descriptor.scriptSetup?.lang) === 'ts';

  // <script> + <script setup> → one component object; rewrite its default to a binding.
  let code: string;
  let bindings: BindingMetadata | undefined;
  if (descriptor.script || descriptor.scriptSetup) {
    const script = compileScript(descriptor, { id, inlineTemplate: false });
    bindings = script.bindings;
    code = rewriteDefault(
      script.content,
      '__sfc_main',
      isTs ? ['typescript'] : []
    );
  } else {
    code = 'const __sfc_main = {};';
  }

  // <template> → render fn, bound to the script's analysed bindings; attached to the component.
  if (descriptor.template) {
    const tpl = compileTemplate({
      source: descriptor.template.content,
      filename: path,
      id,
      scoped: hasScoped,
      compilerOptions: { bindingMetadata: bindings },
    });
    if (tpl.errors.length)
      throw new Error(String(tpl.errors[0]?.valueOf?.() ?? tpl.errors[0]));
    code += `\n${tpl.code}\n__sfc_main.render = render;`;
  }
  if (hasScoped)
    code += `\n__sfc_main.__scopeId = ${JSON.stringify(`data-v-${id}`)};`;
  code += `\n__sfc_main.__file = ${JSON.stringify(path)};\nexport default __sfc_main;`;

  // <style> blocks → scoped CSS, injected as a load-time side effect.
  // NOTE(prototype): plain CSS only; lang="scss"/"less" preprocessing is a TODO.
  const styles = descriptor.styles.map((style) => {
    const res = compileStyle({
      source: style.content,
      filename: path,
      id,
      scoped: style.scoped,
    });
    if (res.errors.length)
      throw new Error(String(res.errors[0]?.message ?? res.errors[0]));
    return res.code;
  });
  if (styles.length)
    code =
      styleInject(`${path}?vue&type=style`, styles.join('\n')) + '\n' + code;

  cache.set(path, { src, out: code });
  return code;
}

/** A JS module that throws on import — substituted for a .vue file that failed to compile. */
export const vueErrorModule = (path: string, message: string): string =>
  `throw new Error(${JSON.stringify(`[vue] ${path}: ${message}`)});`;
