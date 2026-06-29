import { test, expect } from '@playwright/test';

// The default SAMPLE is a Base UI Combobox demo (React 19 + @base-ui/react + a CSS
// module). This guards the whole stack: package.json version pinning, esm.sh resolution
// of a deep scoped subpath, and lightningcss CSS-module scoping — all via the default boot.
test('default sample renders the Base UI combobox', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('synced', {
    timeout: 15000,
  });

  const frame = page.frameLocator('#preview');
  await expect(frame.locator('label')).toHaveText('Choose a fruit', {
    timeout: 30000,
  });
  // The combobox input renders and carries a scoped CSS-module class (lightningcss).
  const input = frame.getByRole('combobox', { name: 'Choose a fruit' });
  await expect(input).toBeVisible();
  await expect(input).toHaveClass(/Input/);
  expect(errors).toEqual([]);
});
