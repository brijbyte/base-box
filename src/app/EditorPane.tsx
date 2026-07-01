import { createEditor } from '../editor';
import { useController, useSnapshot } from './store';
import { useMount } from './useMount';
import { EditorSkeleton } from './Skeletons';
import styles from './EditorPane.module.css';

// This module pulls in the CodeMirror bundle; it's lazy-loaded (see App.tsx) so that
// weight stays out of the initial chunk. `createEditor` is injected into the controller.
export function EditorPane() {
  const c = useController();
  const { filename, editorReady } = useSnapshot();
  const editorRef = useMount((el) => c.mountEditor(el, createEditor));

  return (
    <div className="pane editor">
      <div className="bar">
        <span id="filename">{filename}</span>
      </div>
      <div id="editor" className={styles.editorMount} ref={editorRef} />
      <EditorSkeleton hidden={editorReady} />
    </div>
  );
}

export default EditorPane;
