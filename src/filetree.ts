import type {
  FileTree as FileTreeModel,
  FileTreeOptions,
  FileTreeMutationSemanticEvent,
} from '@pierre/trees';

export interface FileTreeHandlers {
  onAdd: (path: string) => void;
  onRemove: (path: string, recursive: boolean) => void;
  onMove: (from: string, to: string) => void;
}

export interface FileTreePanel {
  add(path: string): void;
  remove(path: string): void;
  startRename(path: string): void;
  /** Inline-create a file: add a placeholder in the selected dir and rename it in place. */
  startCreate(): void;
  select(path: string): void;
  selected(): string | null;
  /** Swap the whole path set (project load) and reselect. */
  resetPaths(paths: string[], selected: string | null): void;
  /** Detach the mutation listener (React effect cleanup). */
  destroy(): void;
}

/** Every directory prefix of `paths`, so a reset re-opens the tree like `initialExpansion: 'open'`. */
function directoryPaths(paths: string[]): string[] {
  const dirs = new Set<string>();
  for (const p of paths) {
    let i = p.indexOf('/');
    while (i !== -1) {
      dirs.add(p.slice(0, i));
      i = p.indexOf('/', i + 1);
    }
  }
  return [...dirs];
}

/** Options for `useFileTree()`. Selection → open is handled in the React view via `useFileTreeSelection`. */
export function fileTreeOptions(
  paths: string[],
  initialSelected: string | null
): FileTreeOptions {
  return {
    paths,
    initialExpansion: 'open',
    initialSelectedPaths: initialSelected ? [initialSelected] : [],
    renaming: true,
    dragAndDrop: true,
  };
}

/**
 * Wraps a React-owned `@pierre/trees` model in the imperative surface the controller
 * drives (toolbar add/rename/remove, project reset). The tree is the source of truth
 * for the path set; structural edits (toolbar, inline rename, drag&drop) emit mutations
 * that the caller mirrors into the in-memory FS.
 */
export function attachTreePanel(
  tree: FileTreeModel,
  handlers: FileTreeHandlers
): FileTreePanel {
  const applySemantic = (e: FileTreeMutationSemanticEvent) => {
    if (e.operation === 'add') handlers.onAdd(e.path);
    else if (e.operation === 'remove') handlers.onRemove(e.path, e.recursive);
    else if (e.operation === 'move') handlers.onMove(e.from, e.to);
    // 'reset' is driven by us; ignore.
  };
  const off = tree.onMutation('*', (event) => {
    if (event.operation === 'batch') event.events.forEach(applySemantic);
    else applySemantic(event);
  });

  const select = (p: string) => {
    // Exclusive selection: item.select() otherwise adds to the set.
    for (const s of tree.getSelectedPaths()) {
      if (s !== p) tree.getItem(s)?.deselect();
    }
    tree.getItem(p)?.select();
  };

  return {
    add: (p) => tree.add(p),
    remove: (p) => tree.remove(p, { recursive: true }),
    startRename: (p) => tree.startRenaming(p),
    startCreate: () => {
      // Target dir = the selected directory, the selected file's parent, else root.
      const sel = tree.getSelectedPaths()[0] ?? tree.getFocusedPath();
      let dir = '';
      if (sel) {
        const item = tree.getItem(sel);
        dir = item?.isDirectory()
          ? sel
          : sel.includes('/')
            ? sel.slice(0, sel.lastIndexOf('/'))
            : '';
      }
      // @pierre/trees reports directory paths with a trailing slash ("src/"); strip it
      // so the join below doesn't produce "src//untitled" (an empty, phantom folder).
      dir = dir.replace(/\/+$/, '');
      const base = dir ? `${dir}/` : '';
      let path = `${base}untitled`;
      for (let i = 1; tree.getItem(path); i++) path = `${base}untitled-${i}`;
      // add → onAdd (placeholder); rename commit → onMove, cancel → onRemove.
      tree.add(path);
      tree.startRenaming(path, { removeIfCanceled: true });
    },
    select,
    selected: () => tree.getSelectedPaths()[0] ?? tree.getFocusedPath(),
    resetPaths: (paths, selected) => {
      tree.resetPaths(paths, { initialExpandedPaths: directoryPaths(paths) });
      if (selected) select(selected);
    },
    destroy: off,
  };
}
