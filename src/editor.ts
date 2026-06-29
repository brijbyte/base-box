import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';

const ext = (path: string) =>
  path.slice(path.lastIndexOf('.') + 1).toLowerCase();

/** Pick a CM6 language extension from a file path. */
function languageFor(path: string): Extension {
  switch (ext(path)) {
    case 'ts':
      return javascript({ typescript: true });
    case 'tsx':
      return javascript({ typescript: true, jsx: true });
    case 'jsx':
      return javascript({ jsx: true });
    case 'js':
    case 'mjs':
    case 'cjs':
      return javascript();
    case 'html':
      return html();
    case 'css':
      return css();
    case 'json':
      return json();
    default:
      return [];
  }
}

export interface Editor {
  /** Load a file: replace contents and switch the language by extension. */
  setFile(path: string, content: string): void;
  getContent(): string;
  setDark(dark: boolean): void;
  focus(): void;
}

/** A CodeMirror 6 editor. `onChange` fires only on user edits, not programmatic loads. */
export function createEditor(
  parent: HTMLElement,
  onChange: (value: string) => void
): Editor {
  const language = new Compartment();
  const theme = new Compartment();
  let suppress = false; // ignore change events during programmatic file loads

  const view = new EditorView({
    parent,
    state: EditorState.create({
      extensions: [
        basicSetup,
        language.of([]),
        theme.of([]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !suppress) onChange(view.state.doc.toString());
        }),
      ],
    }),
  });

  return {
    setFile(path, content) {
      suppress = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
        effects: language.reconfigure(languageFor(path)),
      });
      suppress = false;
    },
    getContent: () => view.state.doc.toString(),
    setDark(dark) {
      view.dispatch({ effects: theme.reconfigure(dark ? oneDark : []) });
    },
    focus: () => view.focus(),
  };
}
