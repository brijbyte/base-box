import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

const SW_ENTRY = '/src/sw.ts';

const injectShell = (html: string, shell: string) =>
  html.replace('<div id="root"></div>', `<div id="root">${shell}</div>`);

/**
 * Compile `src/app/prerender.tsx` to an isolated SSR bundle (deliberately WITHOUT the
 * browser node-polyfills, so `node:stream` etc. are the real Node modules) and return its
 * `render()`. Used by both dev and build so the prerendered shell is identical.
 */
async function loadShellRenderer(): Promise<() => Promise<string>> {
  const { resolve } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const { build } = await import('vite');
  const ssrDir = resolve('node_modules/.cache/base-box-ssr');
  await build({
    configFile: false,
    logLevel: 'error',
    plugins: [react()],
    resolve: { tsconfigPaths: true },
    build: {
      ssr: resolve('src/app/prerender.tsx'),
      outDir: ssrDir,
      emptyOutDir: true,
      minify: false,
      write: true,
      rollupOptions: { output: { entryFileNames: 'prerender.mjs' } },
    },
  });
  const mod = await import(pathToFileURL(resolve(ssrDir, 'prerender.mjs')).href);
  return mod.render;
}

/**
 * Prerender the static app shell (panes, skeletons, status bar) into index.html's #root
 * so the browser paints the shell before React hydrates it. Runs in both dev (request-time
 * transform) and build (post-bundle), so the hydration path is exercised identically.
 */
function prerenderShell(): Plugin {
  // Dev: compile the shell renderer once per server session and reuse it across requests.
  let devRenderer: Promise<() => Promise<string>> | undefined;
  return {
    name: 'base-box-prerender',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      async handler(html, ctx) {
        if (!ctx.server) return html; // build path is handled in closeBundle
        devRenderer ??= loadShellRenderer();
        return injectShell(html, await (await devRenderer)());
      },
    },
    async closeBundle() {
      const { readFileSync, writeFileSync, existsSync, rmSync } = await import(
        'node:fs'
      );
      const { resolve } = await import('node:path');
      const outFile = resolve('dist/index.html');
      if (!existsSync(outFile)) return; // e.g. an SSR-only sub-build
      const render = await loadShellRenderer();
      writeFileSync(outFile, injectShell(readFileSync(outFile, 'utf8'), await render()));
      rmSync(resolve('node_modules/.cache/base-box-ssr'), {
        recursive: true,
        force: true,
      });
    },
  };
}

/**
 * Serves the Service Worker at root scope (`/sw.js`) during dev so it can
 * intercept `/__fs/*`. Transforms `src/sw.ts` through Vite (resolving its
 * imports) and sends `Service-Worker-Allowed: /` to grant root scope.
 */
function serviceWorkerDev(): Plugin {
  return {
    name: 'base-box-sw-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.originalUrl?.split('?')[0] !== '/sw.js') return next();
        try {
          const result = await server.transformRequest(SW_ENTRY);
          if (!result) return next();
          res.setHeader('Content-Type', 'text/javascript');
          res.setHeader('Service-Worker-Allowed', '/');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(result.code);
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

export default defineConfig({
  // nodePolyfills shims buffer/process/path/events etc. that memfs needs in the browser.
  plugins: [
    react(),
    nodePolyfills({ globals: { Buffer: true, process: true } }),
    serviceWorkerDev(),
    prerenderShell(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    // es2022 enables top-level await (main.ts boots via `await filesFromUrl()`);
    // consistent with the Safari 16.4+ floor already required for import maps (§6).
    target: 'es2022',
    rolldownOptions: {
      // Two entries: the host app (index.html) and the SW. The SW must land at the
      // dist root as `sw.js` so its default registration scope is `/`.
      input: { main: 'index.html', sw: 'src/sw.ts' },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js',
      },
    },
  },
});
