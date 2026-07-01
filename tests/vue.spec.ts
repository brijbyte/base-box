import { test, expect } from '@playwright/test';
import { encodeFiles } from '../src/codec';

// A self-contained Vue 3 SFC project, injected via ?files= so the test doesn't depend on
// the default SAMPLE. Exercises the whole .vue path: @vue/compiler-sfc (loaded from esm.sh)
// compiles <script setup> + <template> + <style scoped>, then the result runs through the
// same esbuild + import-map pipeline as any module, with the `vue` runtime from esm.sh.
const VUE_APP = {
  'package.json': JSON.stringify({ dependencies: { vue: '^3.5.13' } }),
  'index.html': `<!doctype html><html><head></head><body><div id="app"></div>
<script type="module" src="./src/main.js"></script></body></html>`,
  'src/main.js': `import { createApp } from "vue";
import App from "./App.vue";
createApp(App).mount("#app");`,
  'src/App.vue': `<script setup>
import { ref } from "vue";
const count = ref(0);
</script>
<template>
  <main>
    <h1>base-box Vue</h1>
    <button @click="count++">count is {{ count }}</button>
  </main>
</template>
<style scoped>
main { color: rgb(10, 20, 30); }
</style>`,
};

test('renders a .vue SFC: compiler-sfc + template + scoped style + reactivity', async ({
  page,
}) => {
  await page.goto(`/?files=${await encodeFiles(VUE_APP)}`);
  await expect(page.locator('#status')).toContainText('synced', {
    timeout: 15000,
  });

  const frame = page.frameLocator('#preview');
  // Template compiled & component mounted via the esm.sh vue runtime.
  await expect(frame.locator('h1')).toHaveText('base-box Vue', {
    timeout: 30000,
  });

  // <style scoped> applied → scopeId on <main> matched the `main[data-v-*]` rule.
  await expect(frame.locator('main')).toHaveCSS('color', 'rgb(10, 20, 30)');

  // Reactivity works: the ref + @click handler from <script setup> are wired up.
  const btn = frame.locator('button');
  await expect(btn).toContainText('count is 0');
  await btn.click();
  await expect(btn).toContainText('count is 1');
});

test('editing a .vue file updates the preview (full reload)', async ({
  page,
}) => {
  await page.goto(`/?files=${await encodeFiles(VUE_APP)}`);
  await expect(page.locator('#status')).toContainText('synced', {
    timeout: 15000,
  });
  await expect(page.frameLocator('#preview').locator('h1')).toHaveText(
    'base-box Vue',
    { timeout: 30000 }
  );

  await page.getByRole('treeitem', { name: 'App.vue' }).click();
  await page.locator('#editor .cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(`<template><h1>edited vue</h1></template>`);

  await expect(page.frameLocator('#preview').locator('h1')).toHaveText(
    'edited vue',
    { timeout: 20000 }
  );
});

test('template picker loads the Vue starter and it renders', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('synced', {
    timeout: 15000,
  });

  await page.locator('#settings').click();
  await page.locator('#template').selectOption('vue');

  // FS swapped to the Vue starter: App.vue appears in the tree and the SFC renders.
  await expect(page.getByRole('treeitem', { name: 'App.vue' })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.frameLocator('#preview').locator('h1')).toContainText(
    'Vue',
    { timeout: 30000 }
  );
});

test('opening a .vue file highlights it (lang-vue) + labels it Vue', async ({
  page,
}) => {
  await page.goto(`/?files=${await encodeFiles(VUE_APP)}&file=src/App.vue`);
  await expect(page.locator('#editor .cm-editor')).toBeVisible();

  // Status bar reflects the Vue language mode.
  await expect(page.locator('#language')).toHaveText('Vue');
  // lang-vue tokenizes the SFC into styled spans (plain-text files produce none).
  await expect(
    page.locator('#editor .cm-content .cm-line span').first()
  ).toBeVisible({ timeout: 10000 });
});

// The Vue language server (Volar's Vue plugin projecting .vue → virtual TS, checked by the
// TS service) boots a real TS engine + types from a CDN, so it gets a long timeout.
const LSP_TIMEOUT = 30000;

test('Vue LSP: reports a type error inside <script setup>', async ({
  page,
}) => {
  const files = await encodeFiles({
    'package.json': JSON.stringify({ dependencies: { vue: '3.5.13' } }),
    'index.html': `<!doctype html><html><head></head><body><div id="app"></div>
<script type="module" src="./src/main.js"></script></body></html>`,
    'src/main.js': `import { createApp } from "vue";
import App from "./App.vue";
createApp(App).mount("#app");`,
    'src/App.vue': `<script setup lang="ts">
const bad: number = 'not a number';
</script>
<template>
  <div>hello</div>
</template>
`,
  });
  await page.goto(`/?files=${files}&file=src/App.vue`);
  await page.locator('#editor .cm-content').click();

  // Volar pushes publishDiagnostics for the virtual TS → CM renders an error squiggle.
  const error = page.locator('#editor .cm-lintRange-error').first();
  await expect(error).toBeVisible({ timeout: LSP_TIMEOUT });
  await error.hover();
  await expect(page.locator('.cm-tooltip-lint')).toContainText(
    "Type 'string' is not assignable to type 'number'",
    { timeout: LSP_TIMEOUT }
  );
});
