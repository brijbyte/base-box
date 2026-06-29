import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { editorTheme } from './editor-theme';

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
  focus(): void;
}

export interface EditorOptions {
  /** Per-file language-server extension (completion/diagnostics/hover). */
  lspSupport?: (path: string) => Extension;
}

/** A CodeMirror 6 editor. `onChange` fires only on user edits, not programmatic loads.
 *  Theming is CSS-variable driven (see editor-theme.ts) — light/dark follow `data-theme`. */
export function createEditor(
  parent: HTMLElement,
  onChange: (value: string) => void,
  options: EditorOptions = {}
): Editor {
  const language = new Compartment();
  const lsp = new Compartment(); // per-file language-server support
  let suppress = false; // ignore change events during programmatic file loads

  const view = new EditorView({
    parent,
    state: EditorState.create({
      extensions: [
        basicSetup,
        editorTheme,
        language.of([]),
        lsp.of([]),
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
        effects: [
          language.reconfigure(languageFor(path)),
          // Reconfiguring closes the previous file's LSP doc and opens this one.
          lsp.reconfigure(options.lspSupport?.(path) ?? []),
        ],
      });
      suppress = false;
    },
    getContent: () => view.state.doc.toString(),
    focus: () => view.focus(),
  };
}
