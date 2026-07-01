import { test, expect } from '@playwright/test';
import { encodeFiles } from '../src/codec';

// A project whose editor content and file tree both overflow their panes, so we can
// prove the panes scroll internally instead of growing the page (which used to push
// the status bar down as the open file changed).
async function overflowingProject() {
  return encodeFiles({
    'index.html': `<!doctype html><html><body><div id="root"></div>
<script type="module" src="./src/main.ts"></script></body></html>`,
    'src/main.ts': Array.from(
      { length: 400 },
      (_, i) => `const x${i} = ${i};`
    ).join('\n'),
    'src/short.ts': `export const short = 1;`,
  });
}

test('status bar stays pinned and panes scroll their own content', async ({
  page,
}) => {
  await page.goto(`/?files=${await overflowingProject()}&file=src/main.ts`);
  await expect(page.locator('#status')).toContainText('synced', {
    timeout: 15000,
  });

  const vh = page.viewportSize()!.height;

  // The grid fills the viewport exactly — its height is not driven by file content.
  const app = await page.locator('#app').boundingBox();
  expect(Math.abs(app!.height - vh)).toBeLessThan(2);

  // The status bar is flush against the bottom of the viewport.
  const bar = await page.locator('#statusbar').boundingBox();
  expect(Math.abs(bar!.y + bar!.height - vh)).toBeLessThan(2);

  // The page itself does not scroll — all overflow lives inside the panes.
  const pageScrolls = await page.evaluate(
    () => document.documentElement.scrollHeight > window.innerHeight + 1
  );
  expect(pageScrolls).toBe(false);

  // The long file overflows the editor, which scrolls internally.
  const editorScrolls = await page.evaluate(() => {
    const s = document.querySelector('#editor .cm-scroller')!;
    return s.scrollHeight > s.clientHeight;
  });
  expect(editorScrolls).toBe(true);

  // The file tree (a @pierre/trees web component with its own shadow-root scroller)
  // stays bounded within the viewport even with many files — it never grows the page.
  const treeOverflowY = await page.evaluate(
    () => getComputedStyle(document.querySelector('#tree')!).overflowY
  );
  expect(treeOverflowY).toBe('auto');
  const tree = await page.locator('#tree').boundingBox();
  expect(tree!.y + tree!.height).toBeLessThanOrEqual(vh + 1);

  // Opening a different (short) file must NOT move the status bar.
  await page.getByRole('treeitem', { name: 'short.ts' }).click();
  await expect(page.locator('#filename')).toHaveText('src/short.ts');
  const bar2 = await page.locator('#statusbar').boundingBox();
  expect(Math.abs(bar2!.y + bar2!.height - vh)).toBeLessThan(2);
});

// The highlighted Select item must stay legible under every color theme. agentic-ui
// fills it with the accent color + white text, but some themes use a light accent, so
// we override to primary text on a neutral tint. Assert that in both appearances.
for (const colorScheme of ['light', 'dark'] as const) {
  test(`Select highlight uses readable contrast tokens (${colorScheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await page.locator('#settings').click();
    // Open the Color theme Select (its trigger shows the current theme "Default").
    await page.getByText('Default', { exact: true }).click();
    const option = page.getByRole('option').first();
    await expect(option).toBeVisible();

    const colors = await option.evaluate((el) => {
      const cs = getComputedStyle(el);
      // Resolve the app tokens the override should be using.
      const probe = document.createElement('div');
      probe.style.color = 'var(--fg)';
      probe.style.backgroundColor = 'var(--selected-bg)';
      document.body.appendChild(probe);
      const ps = getComputedStyle(probe);
      const out = {
        bg: cs.backgroundColor,
        color: cs.color,
        expectBg: ps.backgroundColor,
        expectColor: ps.color,
      };
      probe.remove();
      return out;
    });

    // Primary text on the neutral selected tint — not white-on-accent.
    expect(colors.color).toBe(colors.expectColor);
    expect(colors.bg).toBe(colors.expectBg);
  });
}
