import { FilePlus, SquarePen, Trash2, Download, File } from 'lucide-react';
import { Toolbar, IconButton } from '@ui';
import { useController, useSnapshot } from './store';
import { useMount } from './useMount';
import { TreeSkeleton } from './Skeletons';

export function Sidebar() {
  const c = useController();
  const { booted } = useSnapshot();
  const treeRef = useMount((el) => c.mountTree(el));

  return (
    <div className={`pane sidebar${booted ? '' : ' tree-loading'}`}>
      <div className="bar tree-header">
        <span className="tree-title">
          <File className="chevron" size={16} aria-hidden />
          Files
        </span>
        <Toolbar.Root className="tree-actions" aria-label="File actions">
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
      <div id="tree" ref={treeRef} />
      <TreeSkeleton hidden={booted} />
    </div>
  );
}
