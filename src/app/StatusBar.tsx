import { useSnapshot } from './store';
import { Settings } from './Settings';
import styles from './StatusBar.module.css';

export function StatusBar() {
  const { status, editorStatus: s } = useSnapshot();

  const diagnostics =
    s && (s.errors || s.warnings) ? `✖ ${s.errors}  ⚠ ${s.warnings}` : '✓ 0';
  const hasErrors = !!s && s.errors > 0;
  const cursor = s
    ? `Ln ${s.line}, Col ${s.col}${s.selected ? ` (${s.selected} selected)` : ''}`
    : '';

  return (
    <footer id="statusbar" className={styles.statusbar}>
      <span id="status" className={styles.status}>
        {status}
      </span>
      <span className={styles.statusInfo}>
        <span
          id="diagnostics"
          className={styles.diagnostics}
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
