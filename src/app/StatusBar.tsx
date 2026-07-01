import { useSnapshot } from './store';
import { Settings } from './Settings';

export function StatusBar() {
  const { status, editorStatus: s } = useSnapshot();

  const diagnostics =
    s && (s.errors || s.warnings) ? `✖ ${s.errors}  ⚠ ${s.warnings}` : '✓ 0';
  const hasErrors = !!s && s.errors > 0;
  const cursor = s
    ? `Ln ${s.line}, Col ${s.col}${s.selected ? ` (${s.selected} selected)` : ''}`
    : '';

  return (
    <footer id="statusbar">
      <span id="status">{status}</span>
      <span className="status-info">
        <span
          id="diagnostics"
          title="Errors and warnings"
          data-errors={hasErrors ? '' : undefined}
        >
          {diagnostics}
        </span>
        <span id="cursorPos" title="Line and column">
          {cursor}
        </span>
        <span id="indent" title="Indentation">
          {s?.indent ?? ''}
        </span>
        <span id="language" title="Language mode">
          {s?.language ?? ''}
        </span>
      </span>
      <Settings />
    </footer>
  );
}
