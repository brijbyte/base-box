import * as Comlink from 'comlink';
import type { FileMap } from './types';

export type HotResult = { reload: boolean; boundaries: string[] };

/** The RPC surface the Service Worker exposes (implemented in sw.ts). */
export interface SwApi {
  loadFiles(files: FileMap): number;
  updateFile(path: string, content: string): HotResult | Promise<HotResult>;
}

let registration: ServiceWorkerRegistration | null = null;

/**
 * Register the SW (root scope) and wait until it is active. We deliberately do
 * NOT wait for the host page to be *controlled*: a hard reload loads the page
 * uncontrolled and no `controllerchange` would ever fire (→ infinite hang). The
 * preview iframe is a fresh navigation and gets controlled by the active SW after
 * claim(), which is all we need.
 */
export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service workers are not supported in this browser.');
  }
  registration = await navigator.serviceWorker.register('/sw.js', {
    type: 'module',
    scope: '/',
  });
  await navigator.serviceWorker.ready;
}

/** The worker that serves /__fs/*: prefer the page controller, else the active worker. */
function targetWorker(): ServiceWorker | null {
  return navigator.serviceWorker.controller ?? registration?.active ?? null;
}

// Comlink endpoint for the SW: post to whichever worker serves /__fs/* right now, and
// receive replies on navigator.serviceWorker (the SW posts each reply back to its sender).
const swEndpoint: Comlink.Endpoint = {
  postMessage: (message, transfer) =>
    targetWorker()?.postMessage(message, (transfer ?? []) as Transferable[]),
  addEventListener: (type, listener) =>
    navigator.serviceWorker.addEventListener(type, listener as EventListener),
  removeEventListener: (type, listener) =>
    navigator.serviceWorker.removeEventListener(
      type,
      listener as EventListener
    ),
};

const sw = Comlink.wrap<SwApi>(swEndpoint);

/** Reject if `p` doesn't settle within `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    p.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e))
    );
  });
}

/**
 * Push the FileMap to the serving SW and wait for an ack. Retries because a
 * just-activated worker may not be listening for the first message yet.
 */
export async function syncFiles(files: FileMap, retries = 3): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    try {
      if (!targetWorker())
        throw new Error('No active service worker to sync with.');
      return await withTimeout(sw.loadFiles(files), 4000, 'SW sync');
    } catch (err) {
      if (attempt >= retries) throw err;
    }
  }
}

/**
 * Push a single-file content edit to the SW for HMR. The SW broadcasts a hot update to
 * the preview iframe itself; the ack tells us whether a full reload is needed instead.
 */
export async function updateFile(
  path: string,
  content: string,
  timeout = 4000
): Promise<HotResult> {
  if (!targetWorker()) throw new Error('No active service worker to update.');
  return withTimeout(sw.updateFile(path, content), timeout, 'SW update');
}

/** Re-sync + refresh whenever a new SW takes control (it starts with an empty FS). */
export function onControllerChange(handler: () => void): void {
  navigator.serviceWorker.addEventListener('controllerchange', handler);
}

/** Point the iframe at the SW-served preview, cache-busted to force a reload. */
export function refreshPreview(iframe: HTMLIFrameElement): void {
  iframe.src = `/__fs/index.html?t=${Date.now()}`;
}
