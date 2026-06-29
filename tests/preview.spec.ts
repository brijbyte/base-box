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
  const files = encodeFiles({
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

test('live edit updates the preview', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('synced', {
    timeout: 15000,
  });
  await expect(page.frameLocator('#preview').locator('h1')).toBeVisible({
    timeout: 20000,
  });

  await page.selectOption('#files', 'src/App.tsx');
  const edited = `import { useState } from "react";
export function App() {
  const [n] = useState(0);
  return <h1>Edited {n}</h1>;
}`;
  await page.fill('#editor', edited);

  await expect(page.frameLocator('#preview').locator('h1')).toHaveText(
    'Edited 0',
    {
      timeout: 15000,
    }
  );
});
