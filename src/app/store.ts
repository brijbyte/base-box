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
  return useSyncExternalStore(c.subscribe, c.getSnapshot);
}
