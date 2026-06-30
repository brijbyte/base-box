import { test, expect } from '@playwright/test';

// The default SAMPLE is a Base UI Toast demo (React 19 + @base-ui/react + a CSS module).
// This guards the whole stack: package.json version pinning, esm.sh resolution of a deep
// scoped subpath, and lightningcss CSS-module scoping — all via the default boot.
test('default sample renders the Base UI toast demo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('synced', {
    timeout: 15000,
  });

  const frame = page.frameLocator('#preview');
  const btn = frame.getByRole('button', { name: 'Create toast' });
  await expect(btn).toBeVisible({ timeout: 30000 });
  // The button carries a scoped CSS-module class (lightningcss).
  await expect(btn).toHaveClass(/Button/);
  expect(errors).toEqual([]);
});
