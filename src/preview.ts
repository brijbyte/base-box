import type { FileMap } from './types';

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

/**
 * Push the FileMap to the serving SW and wait for an ack. Retries because a
 * just-activated worker may not be listening for the first message yet.
 */
export async function syncFiles(files: FileMap, retries = 3): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    const worker = targetWorker();
    if (!worker) throw new Error('No active service worker to sync with.');
    try {
      return await postOnce(worker, files, 4000);
    } catch (err) {
      if (attempt >= retries) throw err;
    }
  }
}

function postOnce(
  worker: ServiceWorker,
  files: FileMap,
  timeout: number
): Promise<number> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(
      () => reject(new Error('SW sync timed out')),
      timeout
    );
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      if (e.data?.type === 'files-loaded') resolve(e.data.count as number);
      else reject(new Error('Unexpected SW reply'));
    };
    worker.postMessage({ type: 'load-files', files }, [channel.port2]);
  });
}

/** Re-sync + refresh whenever a new SW takes control (it starts with an empty FS). */
export function onControllerChange(handler: () => void): void {
  navigator.serviceWorker.addEventListener('controllerchange', handler);
}

/** Point the iframe at the SW-served preview, cache-busted to force a reload. */
export function refreshPreview(iframe: HTMLIFrameElement): void {
  iframe.src = `/__fs/index.html?t=${Date.now()}`;
}
