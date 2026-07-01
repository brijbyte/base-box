// A fork of CodeMirror's `basicSetup` (which isn't customizable in place) so we can swap the
// fold-gutter marker for Lucide chevrons. Everything else mirrors the upstream array verbatim.
import {
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine,
  keymap,
} from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import {
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  foldKeymap,
} from '@codemirror/language';
import {
  history,
  defaultKeymap,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import {
  closeBrackets,
  autocompletion,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { lintKeymap } from '@codemirror/lint';

// Lucide icons (chevron-right / chevron-down), inlined to avoid a React dep.
const CHEVRON_RIGHT = 'm9 18 6-6-6-6';
const CHEVRON_DOWN = 'm6 9 6 6 6-6';

/** Fold-gutter marker: a Lucide chevron (down when open, right when folded). */
function foldMarker(open: boolean): HTMLElement {
  const el = document.createElement('span');
  el.className = 'cm-fold-marker';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<svg viewBox="0 0 24 24"><path d="${open ? CHEVRON_DOWN : CHEVRON_RIGHT}" /></svg>`;
  return el;
}

/** `basicSetup` with the default fold gutter replaced by Lucide-chevron markers. */
export const basicSetup: Extension = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  foldGutter({ markerDOM: foldMarker }),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...completionKeymap,
    ...lintKeymap,
    // Tab indents inside the editor instead of moving focus out (Esc first to tab away).
    indentWithTab,
  ]),
];
