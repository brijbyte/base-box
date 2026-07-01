import { Suspense } from 'react';
import { FilePlus, SquarePen, Trash2, Download, File } from 'lucide-react';
import { Toolbar, IconButton } from '@ui';
import { useController, useSnapshot } from './store';
import { TreeSkeleton } from './Skeletons';
import { lazyShell } from './lazyShell';
import styles from './Sidebar.module.css';

// The tree pulls in the @pierre/trees bundle; load it lazily. The TreeSkeleton below
// (gated on `treeReady`) already covers both the chunk-load and mount phases.
const FileTreeView = lazyShell(() => import('./FileTreeView'));

export function Sidebar() {
  const c = useController();
  const { treeReady } = useSnapshot();

  return (
    <div
      className={`pane sidebar ${styles.root}${
        treeReady ? '' : ` ${styles.treeLoading}`
      }`}
    >
      <div className={`bar ${styles.treeHeader}`}>
        <span className={styles.treeTitle}>
          <File className={styles.chevron} size={16} aria-hidden />
          Files
        </span>
        <Toolbar.Root className={styles.treeActions} aria-label="File actions">
          <Toolbar.Button
            render={
              <IconButton
                icon={FilePlus}
                variant="ghost"
                size="xs"
                className="tool-btn"
                title="New File"
                aria-label="New File"
                onClick={() => c.newFile()}
              />
            }
          />
          <Toolbar.Button
            render={
              <IconButton
                icon={SquarePen}
                variant="ghost"
                size="xs"
                className="tool-btn"
                title="Rename"
                aria-label="Rename selected"
                onClick={() => c.rename()}
              />
            }
          />
          <Toolbar.Button
            render={
              <IconButton
                icon={Trash2}
                variant="ghost"
                size="xs"
                className="tool-btn"
                title="Delete"
                aria-label="Delete selected"
                onClick={() => c.remove()}
              />
            }
          />
          <Toolbar.Button
            render={
              <IconButton
                icon={Download}
                variant="ghost"
                size="xs"
                className="tool-btn"
                title="Download all files as a ZIP"
                aria-label="Download files as ZIP"
                onClick={() => c.download()}
              />
            }
          />
        </Toolbar.Root>
      </div>
      <Suspense fallback={null}>
        <FileTreeView />
      </Suspense>
      <TreeSkeleton hidden={treeReady} />
    </div>
  );
}
