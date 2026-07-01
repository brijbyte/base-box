import { useEffect } from 'react';
import { useFileTree, useFileTreeSelection, FileTree } from '@pierre/trees/react';
import { useController } from './store';

/**
 * The file tree, rendered via @pierre/trees' React primitives. `useFileTree`
 * owns the model for the component's lifetime; the controller borrows it (through
 * `registerTree`) for toolbar actions, and drives the in-memory FS off its mutations.
 */
export function FileTreeView() {
  const c = useController();
  // Options are read once (the model persists for the component's lifetime).
  const { model } = useFileTree(c.treeOptions());

  // Hand the model to the controller so toolbar actions / project loads can drive it.
  useEffect(() => c.registerTree(model), [c, model]);

  // Open the selected file (skip directories) — the React-idiomatic onSelectionChange.
  // Depend on the path string, not the fresh array `useFileTreeSelection` returns each
  // render, else the effect re-runs → setState → re-render forever.
  const path = useFileTreeSelection(model)[0] ?? null;
  useEffect(() => {
    if (path && model.getItem(path)?.isDirectory() === false) c.focusCurrent(path);
  }, [c, model, path]);

  return <FileTree model={model} id="tree" />;
}

export default FileTreeView;

