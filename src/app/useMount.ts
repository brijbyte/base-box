import { useLayoutEffect, useRef } from 'react';

/** Mount an imperative widget into a ref'd element once, with StrictMode-safe
 *  teardown. `create(el)` returns a disposer that runs on cleanup/unmount. */
export function useMount(create: (el: HTMLElement) => () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // create is a stable controller method; intentionally mount-once.
    return create(el);
  }, []);
  return ref;
}
