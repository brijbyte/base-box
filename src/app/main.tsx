import '../polyfill';
// Design tokens + resets first (they declare the @layer order); then the token
// bridge that remaps agentic-ui tokens to the app's VS Code / CodeMirror palette.
import '@brijbyte/agentic-ui/tokens';
import '@brijbyte/agentic-ui/reset';
import './theme-bridge.css';
import { StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { filesFromUrl } from '../codec';
import { SAMPLE } from '../sample';
import { Controller } from './controller';
import { App } from './App';

// Top-level await: the FS is populated before first render, so every component can
// assume `controller.fs` is ready — no loading guards. Vite target es2022 allows TLA.
const files = (await filesFromUrl()) ?? SAMPLE;
const controller = new Controller(files);

// The static shell is prerendered into #root at build time (see the prerender plugin);
// hydrate it rather than replacing it, so the first paint is the shell, not a blank page.
hydrateRoot(
  document.getElementById('root')!,
  <StrictMode>
    <App controller={controller} />
  </StrictMode>,
  {
    // The shell intentionally aborts the lazy panes' Suspense boundaries server-side, so
    // React recovers those by client-rendering — expected, not a real error. Swallow that
    // family (dev message text, and the minified #418–#425 hydration/Suspense codes); let
    // anything else surface normally.
    onRecoverableError(error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/aborted|hydrat|Suspense|#4(1[89]|2[0-5])\b/i.test(msg)) return;
      console.error(error);
    },
  }
);
