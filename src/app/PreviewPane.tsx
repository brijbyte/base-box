import { useEffect, useRef } from 'react';
import { RotateCw } from 'lucide-react';
import { IconButton } from '@ui';
import { useController, useSnapshot } from './store';
import { PreviewSkeleton } from './Skeletons';
import { ConsolePanel } from './ConsolePanel';

export function PreviewPane() {
  const c = useController();
  const { previewTitle, preview, previewError } = useSnapshot();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const el = iframeRef.current;
    if (!el) return;
    return c.attachIframe(el); // mount-once: controller owns the iframe lifecycle
  }, []);

  return (
    <div className="pane">
      <div className="bar preview-header">
        <span id="previewTitle">{previewTitle}</span>
        <IconButton
          icon={RotateCw}
          variant="ghost"
          size="xs"
          className="tool-btn"
          id="previewReload"
          title="Reload preview"
          aria-label="Reload preview"
          onClick={() => c.reloadPreview()}
        />
      </div>
      <div className="preview-body">
        {/* src is owned by the controller (refreshPreview); never set in JSX. */}
        <iframe
          id="preview"
          ref={iframeRef}
          sandbox="allow-scripts allow-same-origin"
        />
        <PreviewSkeleton
          visible={preview.visible}
          label={preview.label}
          error={preview.error}
        />
        {previewError && (
          <div id="previewError" className="error-overlay">
            <div className="error-card">
              <div className="error-head">
                <span id="errorTitle" className="error-title">
                  {previewError.title}
                </span>
                <button
                  id="errorDismiss"
                  className="error-dismiss"
                  title="Dismiss"
                  aria-label="Dismiss error"
                  onClick={() => c.clearPreviewError()}
                >
                  ×
                </button>
              </div>
              <pre id="errorMessage" className="error-message">
                {previewError.message}
              </pre>
            </div>
          </div>
        )}
      </div>
      <ConsolePanel />
    </div>
  );
}
