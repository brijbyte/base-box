import { useController, useSnapshot } from './store';
import { useMount } from './useMount';
import { EditorSkeleton } from './Skeletons';

export function EditorPane() {
  const c = useController();
  const { filename, booted } = useSnapshot();
  const editorRef = useMount((el) => c.mountEditor(el));

  return (
    <div className="pane editor">
      <div className="bar">
        <span id="filename">{filename}</span>
      </div>
      <div id="editor" ref={editorRef} />
      <EditorSkeleton hidden={booted} />
    </div>
  );
}
