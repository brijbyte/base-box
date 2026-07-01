// Per-pane loading skeletons (shaped like each pane's eventual content). Ported
// verbatim from the old index.html markup; styled by styles.css.

export function TreeSkeleton({ hidden }: { hidden: boolean }) {
  const widths = ['55%', '45%', '62%', '40%', '50%', '38%', '48%'];
  const indent = [false, true, true, false, true, true, false];
  return (
    <div
      id="treeLoading"
      className="loading-overlay sk-tree"
      hidden={hidden}
      aria-hidden="true"
    >
      {widths.map((w, i) => (
        <div key={i} className={indent[i] ? 'sk-row indent' : 'sk-row'}>
          <span className="skeleton sk-ico" />
          <span className="skeleton sk-bar" style={{ width: w }} />
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
      className="loading-overlay sk-editor"
      hidden={hidden}
      aria-hidden="true"
    >
      {widths.map((w, i) => (
        <div key={i} className="sk-line">
          <span className="skeleton sk-num" />
          {w && <span className="skeleton sk-code" style={{ width: w }} />}
        </div>
      ))}
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
      className="loading-overlay sk-preview"
      hidden={!visible}
      data-error={error ? '' : undefined}
    >
      <div className="sk-preview-body" aria-hidden="true">
        <span className="skeleton sk-title" style={{ width: '45%' }} />
        <span className="skeleton" style={{ width: '92%' }} />
        <span className="skeleton" style={{ width: '80%' }} />
        <span className="skeleton" style={{ width: '88%' }} />
        <span className="skeleton" style={{ width: '70%' }} />
        <span
          className="skeleton"
          style={{ width: '40%', height: 34, marginTop: 8 }}
        />
      </div>
      <span className="loading-label">{label}</span>
    </div>
  );
}
