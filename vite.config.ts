import { defineConfig, type Plugin } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

const SW_ENTRY = '/src/sw.ts';

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
        if (req.url?.split('?')[0] !== '/sw.js') return next();
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
    nodePolyfills({ globals: { Buffer: true, process: true } }),
    serviceWorkerDev(),
  ],
});
