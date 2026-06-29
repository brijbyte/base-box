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

test('theme defaults to system and cycles + persists', async ({ page }) => {
  await page.goto('/');
  const html = page.locator('html');
  const btn = page.locator('#theme');

  // Default: system → no explicit override, CSS prefers-color-scheme decides.
  await expect(btn).toHaveText('Theme: System');
  await expect(html).not.toHaveAttribute('data-theme', /.*/);

  await btn.click();
  await expect(btn).toHaveText('Theme: Light');
  await expect(html).toHaveAttribute('data-theme', 'light');

  await btn.click();
  await expect(html).toHaveAttribute('data-theme', 'dark');

  // Persists across reload.
  await page.reload();
  await expect(page.locator('#theme')).toHaveText('Theme: Dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('file tree switches the open file in CodeMirror', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#editor .cm-editor')).toBeVisible();
  await expect(page.locator('#editor .cm-gutters')).toBeVisible(); // line numbers

  await page.getByRole('treeitem', { name: 'App.tsx' }).click();
  await expect(page.locator('#filename')).toHaveText('src/App.tsx');
  await expect(page.locator('#editor .cm-content')).toContainText('Combobox');

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
