import { Suspense, useEffect, useLayoutEffect, useRef } from 'react';
import { GripVertical } from 'lucide-react';
import {
  Group,
  Panel,
  Separator,
  useGroupRef,
  type Layout,
} from 'react-resizable-panels';
import type { Controller } from './controller';
import { ControllerContext } from './store';
import { Sidebar } from './Sidebar';
import { PreviewPane } from './PreviewPane';
import { StatusBar } from './StatusBar';
import { EditorPaneFallback } from './Skeletons';
import { lazyShell } from './lazyShell';

// The editor pulls in the CodeMirror bundle; load it lazily so it's off the initial chunk.
const EditorPane = lazyShell(() => import('./EditorPane'));

// Persisted pane layout: a simple `{ [panelId]: percent }` map (see index.html's head
// script, which restores it onto the SSR'd panels before hydration to avoid a flash).
const PANES_KEY = 'base-box-panes';

function loadLayout(): Layout | undefined {
  try {
    const raw = localStorage.getItem(PANES_KEY);
    if (raw) return JSON.parse(raw) as Layout;
  } catch {
    /* storage unavailable / malformed — fall back to default sizes */
  }
  return undefined;
}

// useLayoutEffect on the client, a no-op on the server (avoids the SSR warning).
const useIsoLayoutEffect =
  typeof document !== 'undefined' ? useLayoutEffect : useEffect;

/** A 1px drag separator with a centered grip (matches the old gutter look). */
function Gutter({ id, label }: { id: string; label: string }) {
  return (
    <Separator id={id} className="gutter" aria-label={label}>
      <span className="gutter-grip" aria-hidden="true">
        <GripVertical size={16} />
      </span>
    </Separator>
  );
}

export function App({ controller }: { controller: Controller }) {
  const booted = useRef(false);
  const groupRef = useGroupRef();

  // Restore the persisted layout into the library's internal state before paint. We do
  // NOT pass `defaultLayout` (that would make the client's first render differ from the
  // SSR shell); the head script already painted these sizes, so this only re-syncs state.
  useIsoLayoutEffect(() => {
    const stored = loadLayout();
    if (stored) groupRef.current?.setLayout(stored);
  }, [groupRef]);

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
        <Group
          id="panes"
          className="panes"
          orientation="horizontal"
          groupRef={groupRef}
          onLayoutChanged={(layout, meta) => {
            // Persist only real user drags/keys — not programmatic setLayout or resizes.
            if (!meta.isUserInteraction) return;
            try {
              localStorage.setItem(PANES_KEY, JSON.stringify(layout));
            } catch {
              /* storage unavailable (private mode); proportions just won't persist */
            }
          }}
        >
          <Panel
            id="pane-sidebar"
            className="pane-host"
            defaultSize="18%"
            minSize="120px"
            maxSize="360px"
          >
            <Sidebar />
          </Panel>
          <Gutter id="gutter-1" label="Resize file tree" />
          <Panel
            id="pane-editor"
            className="pane-host"
            defaultSize="41%"
            minSize="120px"
          >
            <Suspense fallback={<EditorPaneFallback />}>
              <EditorPane />
            </Suspense>
          </Panel>
          <Gutter id="gutter-2" label="Resize editor" />
          <Panel
            id="pane-preview"
            className="pane-host"
            defaultSize="41%"
            minSize="120px"
          >
            <PreviewPane />
          </Panel>
        </Group>
        <StatusBar />
      </div>
    </ControllerContext.Provider>
  );
}
