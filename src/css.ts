/**
 * Wrap compiled CSS-module output in a JS module: inject the (scoped) CSS into the
 * preview document and default-export the original→scoped class-name map — the shape
 * `import styles from './x.module.css'` expects. Keyed by file path so re-evaluation
 * updates one `<style>` instead of stacking duplicates.
 */
export function cssModuleToJs(
  path: string,
  css: string,
  tokens: Record<string, string>
): string {
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
    `export default ${JSON.stringify(tokens)};`,
  ].join('\n');
}
