/** JS that injects `css` into one `<style data-base-box="<path>">` node (keyed by path,
 * so re-evaluation updates that node instead of stacking duplicates). */
function injectSnippet(path: string, css: string): string[] {
  const id = JSON.stringify(path);
  return [
    `const css = ${JSON.stringify(css)};`,
    `const id = ${id};`,
    `let style = document.querySelector('style[data-base-box="' + id + '"]');`,
    `if (!style) {`,
    `  style = document.createElement('style');`,
    `  style.setAttribute('data-base-box', id);`,
    `  document.head.appendChild(style);`,
    `}`,
    `style.textContent = css;`,
  ];
}

/**
 * Wrap compiled CSS-module output in a JS module: inject the (scoped) CSS into the
 * preview document and default-export the original→scoped class-name map — the shape
 * `import styles from './x.module.css'` expects.
 */
export function cssModuleToJs(
  path: string,
  css: string,
  tokens: Record<string, string>
): string {
  return [
    ...injectSnippet(path, css),
    `export default ${JSON.stringify(tokens)};`,
  ].join('\n');
}

/**
 * Wrap a plain CSS file as a side-effect JS module: inject the CSS, no exports — the
 * shape `import './x.css'` expects (when fetched in a module graph, not via `<link>`).
 */
export function cssToJs(path: string, css: string): string {
  return injectSnippet(path, css).join('\n');
}
