import { useEffect, useLayoutEffect, useRef } from 'react';
import { GripVertical } from 'lucide-react';
import { initResizablePanes } from '../resize';
import type { Controller } from './controller';
import { ControllerContext } from './store';
import { Sidebar } from './Sidebar';
import { EditorPane } from './EditorPane';
import { PreviewPane } from './PreviewPane';
import { StatusBar } from './StatusBar';

function Gutter({ id, label }: { id: string; label: string }) {
  return (
    <div
      className="gutter"
      id={id}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
    >
      <span className="gutter-grip" aria-hidden="true">
        <GripVertical size={16} />
      </span>
    </div>
  );
}

export function App({ controller }: { controller: Controller }) {
  const booted = useRef(false);

  // Resizable panes: wire on mount, dispose on unmount (StrictMode-safe).
  useLayoutEffect(() => initResizablePanes(), []);

  // One-shot engine boot (SW registration + first sync); guarded against StrictMode.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    controller
      .boot()
      .catch((err) => controller.bootError(`Failed to start: ${err.message}`));
  }, [controller]);

  return (
    <ControllerContext.Provider value={controller}>
      <div id="app">
        <Sidebar />
        <Gutter id="gutter1" label="Resize file tree" />
        <EditorPane />
        <Gutter id="gutter2" label="Resize editor" />
        <PreviewPane />
        <StatusBar />
      </div>
    </ControllerContext.Provider>
  );
}
