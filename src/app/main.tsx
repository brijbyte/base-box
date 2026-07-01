import '../polyfill';
// Design tokens + resets first (they declare the @layer order); then the token
// bridge that remaps agentic-ui tokens to the app's VS Code / CodeMirror palette.
import '@brijbyte/agentic-ui/tokens';
import '@brijbyte/agentic-ui/reset';
import './theme-bridge.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { filesFromUrl } from '../codec';
import { SAMPLE } from '../sample';
import { Controller } from './controller';
import { App } from './App';

// Top-level await: the FS is populated before first render, so every component can
// assume `controller.fs` is ready — no loading guards. Vite target es2022 allows TLA.
const files = (await filesFromUrl()) ?? SAMPLE;
const controller = new Controller(files);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App controller={controller} />
  </StrictMode>
);
