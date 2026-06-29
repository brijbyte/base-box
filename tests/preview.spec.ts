import { test, expect } from '@playwright/test';
import { encodeFiles } from '../src/codec';

test('renders React + TS sample via esbuild transform + esm.sh import map (WebKit)', async ({
  page,
}) => {
  await page.goto('/');
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

test('caches esbuild.wasm in Cache Storage', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('synced', {
    timeout: 15000,
  });
  // wasm is compiled lazily on first transform; the React render triggers it.
  await expect(page.frameLocator('#preview').locator('h1')).toBeVisible({
    timeout: 20000,
  });
  const cachedCount = await page.evaluate(async () => {
    const cache = await caches.open('base-box-wasm-v1');
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
  await expect(page.locator('#editor .cm-content')).toContainText('useState');

  await page.getByRole('treeitem', { name: 'index.html' }).click();
  await expect(page.locator('#filename')).toHaveText('index.html');
  await expect(page.locator('#editor .cm-content')).toContainText(
    '<!doctype html>'
  );
});

test('create and delete files via the tree', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('synced', {
    timeout: 15000,
  });

  page.once('dialog', (d) => d.accept('src/extra.ts'));
  await page.getByRole('button', { name: '+ File' }).click();

  const extra = page.getByRole('treeitem', { name: 'extra.ts' });
  await expect(extra).toBeVisible();
  await expect(page.locator('#filename')).toHaveText('src/extra.ts');

  // It's selected after creation; delete it.
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: 'extra.ts' })).toHaveCount(0);
});

test('live edit updates the preview', async ({ page }) => {
  await page.goto('/');
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
