import { EditorView } from '@codemirror/view';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { indentUnit } from '@codemirror/language';
import { forEachDiagnostic } from '@codemirror/lint';
import { basicSetup } from './editor-setup';
import { editorTheme } from './editor-theme';

const ext = (path: string) =>
  path.slice(path.lastIndexOf('.') + 1).toLowerCase();

/** Human-readable language label per file extension (shown in the status bar). */
const LANG_LABELS: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript JSX',
  js: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  jsx: 'JavaScript JSX',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  less: 'Less',
  json: 'JSON',
  vue: 'Vue',
};
const languageLabel = (path: string) =>
  path
    ? (LANG_LABELS[ext(path)] ?? (ext(path).toUpperCase() || 'Plain Text'))
    : '';

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
    case 'vue':
      return (await import('@codemirror/lang-vue')).vue();
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

/** Live editor state shown in the status bar. */
export interface EditorStatus {
  line: number;
  col: number;
  /** Number of selected characters (0 when the selection is empty). */
  selected: number;
  /** Indentation, e.g. "Spaces: 2" or "Tab Size: 4". */
  indent: string;
  language: string;
  errors: number;
  warnings: number;
}

export interface EditorOptions {
  /** Per-file language-server extension (completion/diagnostics/hover). May load
   *  lazily — return a promise and it's applied once the file is still current. */
  lspSupport?: (path: string) => Extension | Promise<Extension>;
  /** Fires on selection/doc/diagnostic changes with the latest status-bar info. */
  onStatus?: (status: EditorStatus) => void;
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
  let langLabel = ''; // current language, from the open file's extension

  // Compute and report status-bar info (cursor, indent, language, diagnostics).
  function reportStatus() {
    if (!options.onStatus) return;
    const { state } = view;
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    let errors = 0;
    let warnings = 0;
    forEachDiagnostic(state, (d) => {
      if (d.severity === 'error') errors++;
      else if (d.severity === 'warning') warnings++;
    });
    const unit = state.facet(indentUnit);
    const indent = unit.includes('\t')
      ? `Tab Size: ${state.tabSize}`
      : `Spaces: ${unit.length}`;
    options.onStatus({
      line: line.number,
      col: head - line.from + 1,
      selected: state.selection.ranges.reduce((n, r) => n + (r.to - r.from), 0),
      indent,
      language: langLabel,
      errors,
      warnings,
    });
  }

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
          // Recompute status on cursor moves, edits, and diagnostic updates.
          if (u.docChanged || u.selectionSet || u.transactions.length)
            reportStatus();
        }),
      ],
    }),
  });

  return {
    setFile(path, content) {
      langLabel = languageLabel(path);
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
