import { test, expect } from '@playwright/test';
import { encodeFiles } from '../src/codec';

// A minimal React counter, injected explicitly so render/edit tests don't depend on
// whatever the default SAMPLE happens to be (currently a network-heavy Base UI demo).
const COUNTER = {
  'index.html': `<!doctype html><html><head></head><body><div id="root"></div>
<script type="module" src="./src/main.tsx"></script></body></html>`,
  'src/main.tsx': `import { createRoot } from "react-dom/client";
import { App } from "./App";
createRoot(document.getElementById("root")!).render(<App />);`,
  'src/App.tsx': `import { useState } from "react";
export function App() {
  const [count, setCount] = useState(0);
  return <main><h1>base-box ⚡️</h1>
    <button onClick={() => setCount((c) => c + 1)}>count is {count}</button></main>;
}`,
};

test('renders React + TS sample via esbuild transform + esm.sh import map (WebKit)', async ({
  page,
}) => {
  await page.goto(`/?files=${await encodeFiles(COUNTER)}`);
  await expect(page.locator('#status')).toContainText('synced', {
    timeout: 15000,
  });

  const frame = page.frameLocator('#preview');
  await expect(frame.locator('h1')).toHaveText('base-box ⚡️', {
    timeout: 20000,
  });

  // React state works (hooks resolved through esm.sh).
  const btn = frame.locator('button');
  await expect(btn).toContainText('count is 0');
  await btn.click();
  await expect(btn).toContainText('count is 1');
});

test('strips TS types & resolves relative imports (no network)', async ({
  page,
}) => {
  const files = await encodeFiles({
    'index.html': `<!doctype html><html><head></head><body><div id="o"></div>
<script type="module" src="./src/main.ts"></script></body></html>`,
    'src/main.ts': `import { sum } from "./math";
const total: number = sum(2, 3);
document.getElementById("o")!.innerHTML = "<h1>total " + total + "</h1>";`,
    'src/math.ts': `export const sum = (a: number, b: number): number => a + b;`,
  });
  await page.goto(`/?files=${files}`);
  await expect(page.locator('#status')).toContainText('synced', {
    timeout: 15000,
  });

  const frame = page.frameLocator('#preview');
  await expect(frame.locator('h1')).toHaveText('total 5', { timeout: 10000 });
});

test('pins esm.sh versions & dedupes from package.json', async ({ page }) => {
  const files = await encodeFiles({
    'package.json': JSON.stringify({
      dependencies: { react: '18.3.1', 'react-dom': '18.3.1' },
    }),
    'index.html': `<!doctype html><html><head></head><body><div id="root"></div>
<script type="module" src="./src/main.tsx"></script></body></html>`,
    'src/main.tsx': `import { createRoot } from "react-dom/client";
import { useState } from "react";
function App() { const [n] = useState(7); return <h1>pinned {n}</h1>; }
createRoot(document.getElementById("root")!).render(<App />);`,
  });
  await page.goto(`/?files=${files}`);
  await expect(page.locator('#status')).toContainText('synced', {
    timeout: 15000,
  });

  // Renders with the pinned React (proves the deduped import map resolves).
  const frame = page.frameLocator('#preview');
  await expect(frame.locator('h1')).toHaveText('pinned 7', { timeout: 20000 });

  // The SW-injected import map pins versions in the path (no query — dedupe relies on
  // esm.sh routing pinned versions to one canonical module).
  const map = await page.evaluate(async () => {
    const html = await (await fetch('/__fs/index.html')).text();
    const m = html.match(/<script type="importmap">(.*?)<\/script>/s);
    return m ? JSON.parse(m[1]).imports : null;
  });
  expect(map.react).toBe('https://esm.sh/react@18.3.1');
  expect(map['react-dom/client']).toBe(
    'https://esm.sh/react-dom@18.3.1/client'
  );
  // Bare entry present even though react-dom's root is never imported directly.
  expect(map['react-dom']).toBe('https://esm.sh/react-dom@18.3.1');
  // Trailing-slash prefix resolves any deep subpath (incl. ones we never lexed).
  expect(map['react-dom/']).toBe('https://esm.sh/react-dom@18.3.1/');
});

test('CSS modules: scopes class names & injects styles (lightningcss)', async ({
  page,
}) => {
  const files = await encodeFiles({
    'index.html': `<!doctype html><html><head></head><body><div id="o"></div>
<script type="module" src="./src/main.ts"></script></body></html>`,
    'src/main.ts': `import styles from "./app.module.css";
const el = document.getElementById("o")!;
el.className = styles.title;
el.textContent = styles.title;`,
    'src/app.module.css': `.title { color: rgb(10, 20, 30); }`,
  });
  await page.goto(`/?files=${files}`);
  await expect(page.locator('#status')).toContainText('synced', {
    timeout: 15000,
  });

  const frame = page.frameLocator('#preview');
  const o = frame.locator('#o');
  // Default export maps `title` -> a scoped name (not the literal "title").
  await expect(o).not.toHaveText('title', { timeout: 15000 });
  await expect(o).not.toBeEmpty();
  // The injected <style> actually applies (scoped selector matched the element).
  await expect(o).toHaveCSS('color', 'rgb(10, 20, 30)');
});

test('side-effect CSS import injects styles (plain .css in a module graph)', async ({
  page,
}) => {
  const files = await encodeFiles({
    'index.html': `<!doctype html><html><head></head><body><div id="o"></div>
<script type="module" src="./src/main.ts"></script></body></html>`,
    // Plain (non-module) CSS imported for its side effect only — no default binding.
    'src/main.ts': `import "./global.css";
document.getElementById("o")!.textContent = "ok";`,
    'src/global.css': `#o { color: rgb(1, 2, 3); }`,
  });
  await page.goto(`/?files=${files}`);
  await expect(page.locator('#status')).toContainText('synced', {
    timeout: 15000,
  });

  const o = page.frameLocator('#preview').locator('#o');
  await expect(o).toHaveText('ok', { timeout: 15000 });
  // The injected <style> applies — proves `.css` was served as a JS module, not text/css.
  await expect(o).toHaveCSS('color', 'rgb(1, 2, 3)');
});

test('caches esbuild.wasm in Cache Storage', async ({ page }) => {
  await page.goto(`/?files=${await encodeFiles(COUNTER)}`);
  await expect(page.locator('#status')).toContainText('synced', {
    timeout: 15000,
  });
  // wasm is compiled lazily on first transform; the React render triggers it.
  await expect(page.frameLocator('#preview').locator('h1')).toBeVisible({
    timeout: 20000,
  });
  const cachedCount = await page.evaluate(async () => {
    // Cache name is versioned (base-box-wasm-<esbuild version>); find it by prefix.
    const name = (await caches.keys()).find((n) =>
      n.startsWith('base-box-wasm-')
    );
    if (!name) return 0;
    const cache = await caches.open(name);
    return (await cache.keys()).length;
  });
  expect(cachedCount).toBeGreaterThan(0);
});

test('mode radios default to system and apply + persist', async ({ page }) => {
  await page.goto('/');
  const html = page.locator('html');
  await page.locator('#settings').click();

  // Default: system → no explicit override, CSS prefers-color-scheme decides.
  await expect(page.getByRole('radio', { name: 'System' })).toBeChecked();
  await expect(html).not.toHaveAttribute('data-theme', /.*/);

  await page.getByRole('radio', { name: 'Light' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');

  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');

  // Persists across reload (anti-FOUC script + initTheme restore it).
  await page.reload();
  await page.locator('#settings').click();
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('file tree switches the open file in CodeMirror', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#editor .cm-editor')).toBeVisible();
  await expect(page.locator('#editor .cm-gutters')).toBeVisible(); // line numbers

  await page.getByRole('treeitem', { name: 'App.tsx' }).click();
  await expect(page.locator('#filename')).toHaveText('src/App.tsx');
  await expect(page.locator('#editor .cm-content')).toContainText('Toast');

  await page.getByRole('treeitem', { name: 'index.html' }).click();
  await expect(page.locator('#filename')).toHaveText('index.html');
  await expect(page.locator('#editor .cm-content')).toContainText(
    'Base UI Example'
  );
});

test('create and delete files via the tree (inline new-file)', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('synced', {
    timeout: 15000,
  });

  // Select a file in src so the new file is created inside src/.
  await page.getByRole('treeitem', { name: 'App.tsx' }).click();
  await page.getByRole('button', { name: 'New File' }).click();

  // Inline input appears with the placeholder text selected; type the real name.
  const input = page.locator('input[data-item-rename-input]');
  await expect(input).toBeVisible();
  await input.fill('extra.ts');
  await input.press('Enter');

  const extra = page.getByRole('treeitem', { name: 'extra.ts' });
  await expect(extra).toBeVisible();
  await expect(page.locator('#filename')).toHaveText('src/extra.ts');

  // It's selected after creation; delete it.
  await page.getByRole('button', { name: 'Delete selected' }).click();
  await expect(page.getByRole('treeitem', { name: 'extra.ts' })).toHaveCount(0);
});

test('new file inside a selected folder is not nested in a phantom dir', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('synced', {
    timeout: 15000,
  });

  // Select the `src` *directory* (its selected path comes back as "src/").
  await page.getByRole('treeitem', { name: 'src' }).click();
  await page.getByRole('button', { name: 'New File' }).click();

  const input = page.locator('input[data-item-rename-input]');
  await expect(input).toBeVisible();
  await input.fill('indir.ts');
  await input.press('Enter');

  // Created directly under src/ — not under an empty-named ("src//indir.ts") folder.
  await expect(page.locator('#filename')).toHaveText('src/indir.ts');
  await expect(page.getByRole('treeitem', { name: 'indir.ts' })).toBeVisible();
});

test('canceling inline new-file (Escape) leaves no file', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('synced', {
    timeout: 15000,
  });

  await page.getByRole('button', { name: 'New File' }).click();
  const input = page.locator('input[data-item-rename-input]');
  await expect(input).toBeVisible();
  await input.press('Escape');

  // Placeholder removed; no stray "untitled" file remains.
  await expect(page.getByRole('treeitem', { name: /untitled/ })).toHaveCount(0);
  await expect(input).toHaveCount(0);
});

test('CSS edit hot-updates without losing React state (HMR)', async ({
  page,
}) => {
  const files = {
    'index.html': `<!doctype html><html><head></head><body><div id="root"></div>
<script type="module" src="./src/main.tsx"></script></body></html>`,
    'src/main.tsx': `import "./box.css";
import { createRoot } from "react-dom/client";
import { useState } from "react";
function App() {
  const [c, setC] = useState(0);
  return <button id="b" onClick={() => setC((x) => x + 1)}>count {c}</button>;
}
createRoot(document.getElementById("root")!).render(<App />);`,
    'src/box.css': `#b { color: rgb(1, 2, 3); }`,
  };
  await page.goto(`/?files=${await encodeFiles(files)}`);
  await expect(page.locator('#status')).toContainText('synced', {
    timeout: 15000,
  });

  const frame = page.frameLocator('#preview');
  const btn = frame.locator('#b');
  await expect(btn).toHaveText('count 0', { timeout: 20000 });
  await expect(btn).toHaveCSS('color', 'rgb(1, 2, 3)');

  // Build up state a reload would wipe.
  await btn.click();
  await expect(btn).toHaveText('count 1');

  // Edit the CSS file via the editor.
  await page.getByRole('treeitem', { name: 'box.css' }).click();
  await page.locator('#editor .cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('#b { color: rgb(4, 5, 6); }');

  // Style swaps in place AND the React state survives → it was a hot update, not a reload.
  await expect(btn).toHaveCSS('color', 'rgb(4, 5, 6)', { timeout: 15000 });
  await expect(btn).toHaveText('count 1');
  await expect(page.locator('#status')).toContainText('hot-updated');
});

test('JS module with import.meta.hot.accept hot-swaps, preserving window state (HMR)', async ({
  page,
}) => {
  const body = (msg: string) => `const MSG = "${msg}";
const o = document.getElementById("o")!;
function paint() { o.textContent = MSG + " " + ((window as any).__n ?? 0); }
paint();
import.meta.hot.accept(() => {});`;
  const files = {
    'index.html': `<!doctype html><html><head></head><body><div id="o"></div>
<script type="module" src="./src/main.ts"></script></body></html>`,
    'src/main.ts': body('A'),
  };
  await page.goto(`/?files=${await encodeFiles(files)}`);
  await expect(page.locator('#status')).toContainText('synced', {
    timeout: 15000,
  });

  const o = page.frameLocator('#preview').locator('#o');
  await expect(o).toHaveText('A 0', { timeout: 20000 });

  // Seed iframe window state that a full reload would wipe.
  await o.evaluate(() => {
    (window as unknown as { __n: number }).__n = 5;
  });

  // Edit the self-accepting module.
  await page.getByRole('treeitem', { name: 'main.ts' }).click();
  await page.locator('#editor .cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(body('B'));

  // New code ran ("B") AND window.__n survived ("5") → hot-swapped, not reloaded.
  await expect(o).toHaveText('B 5', { timeout: 15000 });
  await expect(page.locator('#status')).toContainText('hot-updated');
});

test('pane loading overlays clear once each pane is ready', async ({
  page,
}) => {
  await page.goto(`/?files=${await encodeFiles(COUNTER)}`);

  // Tree + editor render from the decoded FS without waiting on the SW.
  await expect(page.locator('#treeLoading')).toBeHidden({ timeout: 10000 });
  await expect(page.locator('#editorLoading')).toBeHidden({ timeout: 10000 });

  // Preview overlay clears only after the app actually renders (iframe `load`).
  await expect(page.frameLocator('#preview').locator('h1')).toBeVisible({
    timeout: 20000,
  });
  await expect(page.locator('#previewLoading')).toBeHidden({ timeout: 20000 });
});

test('live edit updates the preview', async ({ page }) => {
  await page.goto(`/?files=${await encodeFiles(COUNTER)}`);
  await expect(page.locator('#status')).toContainText('synced', {
    timeout: 15000,
  });
  await expect(page.frameLocator('#preview').locator('h1')).toBeVisible({
    timeout: 20000,
  });

  await page.getByRole('treeitem', { name: 'App.tsx' }).click();
  const edited = `import { useState } from "react";
export function App() {
  const [n] = useState(0);
  return <h1>Edited {n}</h1>;
}`;
  // CodeMirror is contenteditable, not a textarea: select-all then bulk-insert.
  await page.locator('#editor .cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(edited);

  await expect(page.frameLocator('#preview').locator('h1')).toHaveText(
    'Edited 0',
    {
      timeout: 15000,
    }
  );
});

test('runtime error in user code shows the preview error overlay', async ({
  page,
}) => {
  const files = await encodeFiles({
    'index.html': `<!doctype html><html><head></head><body><div id="root"></div>
<script type="module" src="./src/main.ts"></script></body></html>`,
    'src/main.ts': `throw new Error("boom from user code");`,
  });
  await page.goto(`/?files=${files}`);

  // The iframe's error handler posts the throw to the host → overlay shows.
  await expect(page.locator('#previewError')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#errorTitle')).toContainText('Runtime error');
  const message = page.locator('#errorMessage');
  await expect(message).toContainText('boom from user code');
  // Stack frames show the project-relative path, not the internal /__fs/ SW URL.
  await expect(message).toContainText('src/main.ts');
  await expect(message).not.toContainText('/__fs/');
});

test('compile error (syntax) shows the preview error overlay & dismisses', async ({
  page,
}) => {
  const files = await encodeFiles({
    'index.html': `<!doctype html><html><head></head><body><div id="root"></div>
<script type="module" src="./src/main.ts"></script></body></html>`,
    'src/main.ts': `const x = (;`, // invalid syntax → esbuild transform throws in the SW
  });
  await page.goto(`/?files=${files}`);

  // The SW's compile-error stub posts to the host instead of silently failing.
  await expect(page.locator('#previewError')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#errorTitle')).toContainText('Compile error');
  await expect(page.locator('#errorTitle')).toContainText('src/main.ts');

  await page.locator('#errorDismiss').click();
  await expect(page.locator('#previewError')).toBeHidden();
});

// --- TypeScript language server (Volar in a worker, types from jsdelivr) ---
// These boot a real TS engine from a CDN on first open, so they're given long timeouts.
const LSP_TIMEOUT = 30000;

// Open a TS file in the editor (the LSP only attaches to the focused code file).
async function openTsFile(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('treeitem', { name }).click();
  await page.locator('#editor .cm-content').click();
}

test('LSP: reports type-error diagnostics from the TS server', async ({
  page,
}) => {
  const files = await encodeFiles({
    'index.html': `<!doctype html><html><head></head><body><div id="root"></div>
<script type="module" src="./src/App.tsx"></script></body></html>`,
    'src/App.tsx': `const x: number = "not a number";\nexport {};\n`,
  });
  await page.goto(`/?files=${files}`);
  await openTsFile(page, 'App.tsx');

  // Volar pushes publishDiagnostics → CM renders an error squiggle.
  await expect(page.locator('#editor .cm-lintRange-error').first()).toBeVisible(
    {
      timeout: LSP_TIMEOUT,
    }
  );
});

test('LSP: autocomplete offers type-aware completions', async ({ page }) => {
  const files = await encodeFiles({
    'index.html': `<!doctype html><html><head></head><body><div id="root"></div>
<script type="module" src="./src/App.tsx"></script></body></html>`,
    'src/App.tsx': `const greeting = "hello";\nexport {};\n`,
  });
  await page.goto(`/?files=${files}`);
  await openTsFile(page, 'App.tsx');
  // Wait for the server to be ready (diagnostics is a cheap readiness signal: none here).
  await page.waitForTimeout(12000);

  // Type `greeting.` and ask for completions; string members should appear.
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('const greeting = "hello";\ngreeting.');
  await page.keyboard.press('Control+Space');
  const tip = page.locator('.cm-tooltip-autocomplete');
  await expect(tip).toBeVisible({ timeout: LSP_TIMEOUT });
  await expect(tip).toContainText('toUpperCase');
});

test('LSP: hover shows inferred type info', async ({ page }) => {
  const files = await encodeFiles({
    'index.html': `<!doctype html><html><head></head><body><div id="root"></div>
<script type="module" src="./src/App.tsx"></script></body></html>`,
    'src/App.tsx': `const myValue = 42;\nconsole.log(myValue);\nexport {};\n`,
  });
  await page.goto(`/?files=${files}`);
  await openTsFile(page, 'App.tsx');
  await page.waitForTimeout(12000);

  // Hover the `myValue` usage on line 2 → type tooltip.
  await page
    .locator('#editor .cm-content .cm-line')
    .nth(1)
    .getByText('myValue')
    .first()
    .hover();
  await expect(page.locator('.cm-lsp-hover-tooltip')).toContainText(
    'const myValue: 42',
    { timeout: LSP_TIMEOUT }
  );
});

test('LSP: resolves react/jsx-runtime types from range deps (no phantom errors)', async ({
  page,
}) => {
  // `@types/react` must resolve so JSX type-checks. Range versions (^18) only work
  // because non-exact pins fall back to jsdelivr's `latest` resolution (see ts-worker).
  const files = await encodeFiles({
    'index.html': `<!doctype html><html><head></head><body><div id="root"></div>
<script type="module" src="./src/App.tsx"></script></body></html>`,
    'src/App.tsx': `export function App() {
  const bad: number = "nope"; // the only error: string→number
  return <div className="x">{bad}</div>;
}
`,
    'package.json': `{"dependencies":{"react":"^18.3.1"},"devDependencies":{"@types/react":"^18"}}`,
  });
  await page.goto(`/?files=${files}`);
  await openTsFile(page, 'App.tsx');

  // Server ran → the deliberate error shows; JSX itself must NOT add errors (it would if
  // react/jsx-runtime were unresolved), so the count settles at exactly one.
  const errors = page.locator('#editor .cm-lintRange-error');
  await expect(errors.first()).toBeVisible({ timeout: LSP_TIMEOUT });
  await expect(errors).toHaveCount(1);
  await errors.first().hover();
  await expect(page.locator('.cm-tooltip-lint')).toContainText(
    "Type 'string' is not assignable to type 'number'"
  );
});

test('CSS LSP: reports a syntax-error diagnostic from the CSS server', async ({
  page,
}) => {
  test.slow(); // first CSS test eats the one-time cold transform of the LS worker
  const files = await encodeFiles({
    'index.html': `<!doctype html><html><head><link rel="stylesheet" href="./styles.css"></head><body></body></html>`,
    'styles.css': `.box { color red }\n`, // missing colon → "colon expected"
  });
  await page.goto(`/?files=${files}`);
  await openTsFile(page, 'styles.css');

  // The CSS worker pushes publishDiagnostics → CM renders an error squiggle. The worker is
  // self-contained (no CDN), so this is fast — but keep the shared long timeout for CI.
  await expect(page.locator('#editor .cm-lintRange-error').first()).toBeVisible(
    {
      timeout: LSP_TIMEOUT,
    }
  );
});

test('CSS LSP: hover shows MDN property docs', async ({ page }) => {
  // Hover (with MDN docs) is LSP-only — unlike completion, `@codemirror/lang-css` doesn't
  // provide it — so this isolates the CSS language server.
  const files = await encodeFiles({
    'index.html': `<!doctype html><html><head><link rel="stylesheet" href="./styles.css"></head><body></body></html>`,
    'styles.css': `.box { color: red; }\n`,
  });
  await page.goto(`/?files=${files}`);
  await openTsFile(page, 'styles.css');
  await page.waitForTimeout(2000); // let the worker boot + didOpen land

  await page
    .locator('#editor .cm-content .cm-line')
    .first()
    .getByText('color')
    .first()
    .hover();
  await expect(page.locator('.cm-lsp-hover-tooltip')).toContainText(
    "Sets the color of an element's text",
    { timeout: LSP_TIMEOUT }
  );
});
