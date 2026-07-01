// Per-pane loading skeletons (shaped like each pane's eventual content). Ported
// verbatim from the old index.html markup. Shapes live in Skeletons.module.css;
// the base `.skeleton`/`.loading-overlay`/`.pane`/`.bar` primitives stay global.
import styles from './Skeletons.module.css';

export function TreeSkeleton({ hidden }: { hidden: boolean }) {
  const widths = ['55%', '45%', '62%', '40%', '50%', '38%', '48%'];
  const indent = [false, true, true, false, true, true, false];
  return (
    <div
      id="treeLoading"
      className={`loading-overlay ${styles.skTree}`}
      hidden={hidden}
      aria-hidden="true"
    >
      {widths.map((w, i) => (
        <div
          key={i}
          className={
            indent[i] ? `${styles.skRow} ${styles.indent}` : styles.skRow
          }
        >
          <span className={`skeleton ${styles.skIco}`} />
          <span className={`skeleton ${styles.skBar}`} style={{ width: w }} />
        </div>
      ))}
    </div>
  );
}

export function EditorSkeleton({ hidden }: { hidden: boolean }) {
  const widths = [
    '35%',
    '62%',
    '48%',
    '',
    '70%',
    '55%',
    '40%',
    '',
    '66%',
    '30%',
    '52%',
    '44%',
  ];
  return (
    <div
      id="editorLoading"
      className={`loading-overlay ${styles.skEditor}`}
      hidden={hidden}
      aria-hidden="true"
    >
      {widths.map((w, i) => (
        <div key={i} className={styles.skLine}>
          <span className={`skeleton ${styles.skNum}`} />
          {w && (
            <span
              className={`skeleton ${styles.skCode}`}
              style={{ width: w }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/** Suspense fallback for the lazy <EditorPane>: the pane shell + skeleton, shown while
 *  the CodeMirror chunk loads (before the real pane's own mount skeleton takes over). */
export function EditorPaneFallback() {
  return (
    <div className="pane editor">
      <div className="bar">
        <span id="filename" />
      </div>
      <EditorSkeleton hidden={false} />
    </div>
  );
}

export function PreviewSkeleton({
  visible,
  label,
  error,
}: {
  visible: boolean;
  label: string;
  error: boolean;
}) {
  return (
    <div
      id="previewLoading"
      className={`loading-overlay ${styles.skPreview}`}
      hidden={!visible}
      data-error={error ? '' : undefined}
    >
      <div className={styles.skPreviewBody} aria-hidden="true">
        <span
          className={`skeleton ${styles.skTitle}`}
          style={{ width: '45%' }}
        />
        <span className="skeleton" style={{ width: '92%' }} />
        <span className="skeleton" style={{ width: '80%' }} />
        <span className="skeleton" style={{ width: '88%' }} />
        <span className="skeleton" style={{ width: '70%' }} />
        <span
          className="skeleton"
          style={{ width: '40%', height: 34, marginTop: 8 }}
        />
      </div>
      <span className={styles.loadingLabel}>{label}</span>
    </div>
  );
}
