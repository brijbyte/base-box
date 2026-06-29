import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { editorTheme } from './editor-theme';

const ext = (path: string) =>
  path.slice(path.lastIndexOf('.') + 1).toLowerCase();

/** Pick a CM6 language extension from a file path. Each lang package is loaded
 *  lazily on first open of its file type, so the initial bundle ships none of them. */
async function languageFor(path: string): Promise<Extension> {
  switch (ext(path)) {
    case 'ts':
      return (await import('@codemirror/lang-javascript')).javascript({
        typescript: true,
      });
    case 'tsx':
      return (await import('@codemirror/lang-javascript')).javascript({
        typescript: true,
        jsx: true,
      });
    case 'jsx':
      return (await import('@codemirror/lang-javascript')).javascript({
        jsx: true,
      });
    case 'js':
    case 'mjs':
    case 'cjs':
      return (await import('@codemirror/lang-javascript')).javascript();
    case 'html':
      return (await import('@codemirror/lang-html')).html();
    case 'css':
      return (await import('@codemirror/lang-css')).css();
    case 'json':
      return (await import('@codemirror/lang-json')).json();
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
  /** Per-file language-server extension (completion/diagnostics/hover). May load
   *  lazily — return a promise and it's applied once the file is still current. */
  lspSupport?: (path: string) => Extension | Promise<Extension>;
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
  let loadToken = 0; // guards async language/LSP loads against a newer setFile

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
      // Show the content immediately and clear the previous file's language/LSP
      // (this also closes its LSP doc); the real extensions load in asynchronously.
      suppress = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
        effects: [language.reconfigure([]), lsp.reconfigure([])],
      });
      suppress = false;
      // A newer setFile bumps the token, so stale loads no-op instead of clobbering.
      const token = ++loadToken;
      const apply = (compartment: Compartment, ext: Extension) => {
        if (token === loadToken)
          view.dispatch({ effects: compartment.reconfigure(ext) });
      };
      void languageFor(path).then((ext) => apply(language, ext));
      void Promise.resolve(options.lspSupport?.(path) ?? []).then((ext) =>
        apply(lsp, ext)
      );
    },
    getContent: () => view.state.doc.toString(),
    focus: () => view.focus(),
  };
}
