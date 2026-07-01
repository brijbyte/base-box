// React glue for the Controller: a context to reach it and a hook that reads its
// reactive snapshot via useSyncExternalStore.
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Controller, Snapshot } from './controller';

export const ControllerContext = createContext<Controller | null>(null);

export function useController(): Controller {
  const c = useContext(ControllerContext);
  if (!c) throw new Error('ControllerContext missing');
  return c;
}

export function useSnapshot(): Snapshot {
  const c = useController();
  // Third arg = server snapshot (for the build-time prerender/hydration); getSnapshot is
  // pure and returns the initial shell state on the server, so it doubles for both.
  return useSyncExternalStore(c.subscribe, c.getSnapshot, c.getSnapshot);
}
