# base-box

An in-browser code playground (CodeSandbox-style) that runs **entirely client-side** — no
backend, no build server. It serves your files through a **Service Worker** that plays the
role of a dev server, transforms TS/JSX on the fly with **esbuild-wasm**, resolves npm
packages via **esm.sh**, and boots from a shareable URL.

> Think "Vite dev mode, reimplemented in a browser tab": files are served as native ESM,
> each one is transformed on demand, and bare imports are rewritten to resolvable URLs —
> all inside the page, with the Service Worker standing in for the HTTP dev server.

## Features

- **Live preview** of browser/frontend apps (React / vanilla) rendered into a sandboxed
  `<iframe>`.
- **Native ESM + import maps** — no app-level bundler at runtime; npm internals resolve
  through `https://esm.sh`.
- **On-demand transforms** — `esbuild-wasm` strips TS/JSX per file; `lightningcss-wasm`
  compiles `*.module.css` (scoped class names + injected styles).
- **HMR** — editor writes update the in-memory FS and hot-swap modules (or full-reload when
  there's no accept boundary); CSS swaps in place.
- **Full editor** — CodeMirror 6 with TypeScript IntelliSense (Volar in a worker) and a
  CSS/SCSS/LESS language server, plus a file tree, status bar, and error overlay.
- **Stateless & shareable** — the whole project is encoded into a `?files=<base64>` URL, so
  a link fully reconstructs the playground. No database, deployable as static files.
- **Runs in Safari/WebKit** — verified end-to-end (dev + production build) via Playwright.

## Running locally

Requires **Node.js 18+** and a package manager (examples use `npm`).

```bash
# install dependencies
npm install

# start the dev server (Vite)
npm run dev
```

Then open the URL Vite prints (default <http://localhost:5173>). With no `?files=` param it
boots a default Base UI sample project.

### Production build

```bash
npm run build     # tsc + vite build → dist/
npm run preview   # serve the production build locally
```

### Other scripts

```bash
npm test          # Playwright tests against the dev server
npm run test:prod # Playwright tests against the production build
npm run lint      # ESLint
npm run format    # Prettier (write)
```

## How it works

```
URL (?files=base64) ─► decode ─► in-memory FS (Map<path, string>)
                                        │
      ┌─────────────────────────────────┤
      ▼                                  ▼
 Editor (CodeMirror 6)          Service Worker  ← "the dev server"
   │  on edit → write FS          │ intercepts fetch /__fs/*
   └──────────────────────────►   │ 1. read file from FS
                                   │ 2. esbuild-wasm transform (TS/JSX/CJS → ESM)
                                   │ 3. rewrite imports: './x' → /__fs/src/x.js,
                                   │    'react' → https://esm.sh/react (import map)
                                   ▼
                            Preview <iframe> loads /__fs/index.html
                            → native ESM <script type="module">
```

| Vite dev concept              | base-box equivalent                   |
| ----------------------------- | ------------------------------------- |
| Dev HTTP server               | Service Worker `fetch` handler        |
| Per-file esbuild transform    | `esbuild-wasm` `transform()` per file |
| Bare-import rewrite/prebundle | import map → `https://esm.sh/{pkg}`   |
| File watcher / HMR            | Editor writes FS → re-fetch / reload  |

## Tech stack

Vite · TypeScript · CodeMirror 6 · esbuild-wasm · lightningcss-wasm · esm.sh · Comlink ·
memfs · Volar (TS language service) · vscode-css-languageservice.

## License

MIT
