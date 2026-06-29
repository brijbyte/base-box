import { FileTree, type FileTreeMutationSemanticEvent } from '@pierre/trees';

export interface FileTreeHandlers {
  /** A file (not a directory) was selected/opened. */
  onOpen: (path: string) => void;
  onAdd: (path: string) => void;
  onRemove: (path: string, recursive: boolean) => void;
  onMove: (from: string, to: string) => void;
}

export interface FileTreePanel {
  add(path: string): void;
  remove(path: string): void;
  startRename(path: string): void;
  select(path: string): void;
  selected(): string | null;
}

/**
 * Wraps @pierre/trees (vanilla). The tree is the source of truth for the path
 * set; structural edits (add/remove/move via toolbar, inline rename, drag&drop)
 * emit mutations that the caller mirrors into the in-memory FS.
 */
export function createFileTree(
  mount: HTMLElement,
  paths: string[],
  initialSelected: string | null,
  handlers: FileTreeHandlers
): FileTreePanel {
  const tree = new FileTree({
    paths,
    initialExpansion: 'open',
    initialSelectedPaths: initialSelected ? [initialSelected] : [],
    renaming: true,
    dragAndDrop: true,
    onSelectionChange: (selected) => {
      const path = selected[0];
      if (path && tree.getItem(path)?.isDirectory() === false) {
        handlers.onOpen(path);
      }
    },
  });

  const applySemantic = (e: FileTreeMutationSemanticEvent) => {
    if (e.operation === 'add') handlers.onAdd(e.path);
    else if (e.operation === 'remove') handlers.onRemove(e.path, e.recursive);
    else if (e.operation === 'move') handlers.onMove(e.from, e.to);
    // 'reset' is driven by us; ignore.
  };
  tree.onMutation('*', (event) => {
    if (event.operation === 'batch') event.events.forEach(applySemantic);
    else applySemantic(event);
  });

  tree.render({ containerWrapper: mount });

  return {
    add: (p) => tree.add(p),
    remove: (p) => tree.remove(p, { recursive: true }),
    startRename: (p) => tree.startRenaming(p),
    select: (p) => {
      // Exclusive selection: programmatic select() otherwise adds to the set.
      for (const s of tree.getSelectedPaths()) {
        if (s !== p) tree.getItem(s)?.deselect();
      }
      tree.getItem(p)?.select();
    },
    selected: () => tree.getSelectedPaths()[0] ?? tree.getFocusedPath(),
  };
}
