import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

/**
 * A VS Code-style CodeMirror theme driven entirely by CSS custom properties
 * (`--cm-*` / `--tok-*` defined per light/dark block in index.html). Because the
 * rules reference `var()`, flipping `data-theme` on <html> re-themes the editor
 * with no reconfigure — the same palette also feeds the tree and app chrome.
 */
const view = EditorView.theme({
  '&': {
    color: 'var(--cm-fg)',
    backgroundColor: 'var(--cm-bg)',
  },
  '.cm-content': { caretColor: 'var(--cm-cursor)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--cm-cursor)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--cm-selection)' },
  '.cm-activeLine': { backgroundColor: 'var(--cm-active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--cm-active-line)' },
  '.cm-gutters': {
    backgroundColor: 'var(--cm-bg)',
    color: 'var(--cm-gutter-fg)',
    border: 'none',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--cm-gutter-fg)',
  },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    backgroundColor: 'var(--cm-selection)',
    outline: '1px solid var(--cm-gutter-fg)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--control-bg)',
    border: '1px solid var(--border)',
    color: 'var(--fg)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--accent)',
    color: '#fff',
  },
});

const highlight = HighlightStyle.define([
  {
    tag: [t.comment, t.lineComment, t.blockComment],
    color: 'var(--tok-comment)',
    fontStyle: 'italic',
  },
  {
    tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword],
    color: 'var(--tok-keyword)',
  },
  {
    tag: [t.string, t.special(t.string), t.regexp],
    color: 'var(--tok-string)',
  },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--tok-number)' },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName],
    color: 'var(--tok-function)',
  },
  {
    tag: [t.typeName, t.className, t.namespace, t.tagName],
    color: 'var(--tok-type)',
  },
  {
    tag: [t.variableName, t.propertyName, t.attributeName],
    color: 'var(--tok-variable)',
  },
  {
    tag: [t.operator, t.punctuation, t.separator, t.bracket, t.derefOperator],
    color: 'var(--tok-operator)',
  },
  { tag: [t.definition(t.variableName)], color: 'var(--tok-variable)' },
  { tag: [t.propertyName, t.attributeValue], color: 'var(--tok-variable)' },
  { tag: [t.heading], color: 'var(--tok-keyword)', fontWeight: 'bold' },
  {
    tag: [t.link, t.url],
    color: 'var(--tok-function)',
    textDecoration: 'underline',
  },
  { tag: [t.invalid], color: 'var(--tok-string)' },
]);

/** The full editor theme: chrome + syntax, both var-driven (light/dark via CSS). */
export const editorTheme: Extension = [view, syntaxHighlighting(highlight)];
