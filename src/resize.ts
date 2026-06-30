// Independently resizable panes via two drag gutters. Sizes persist as percentages
// (of the panes' combined width, gutters excluded) and re-hydrate to pixels on load,
// so the layout adapts to any viewport width while keeping the user's proportions.

const STORAGE_KEY = 'base-box-pane-sizes';
const GUTTER_W = 1; // keep in sync with --gutter-w in styles.css
const MIN_PANE = 120; // px floor so no pane collapses to nothing
const MAX_SIDEBAR = 360; // px ceiling for the file-tree pane

type Sizes = { sidebar: number; editor: number; preview: number }; // percentages, sum 100

const DEFAULT: Sizes = { sidebar: 18, editor: 41, preview: 41 };

function load(): Sizes {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    const s = JSON.parse(raw) as Partial<Sizes>;
    if (
      typeof s.sidebar === 'number' &&
      typeof s.editor === 'number' &&
      typeof s.preview === 'number'
    )
      return s as Sizes;
  } catch {
    /* fall through to default */
  }
  return DEFAULT;
}

function save(s: Sizes) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode); proportions just won't persist */
  }
}

/** Wire up the two gutters; hydrate stored percentages into pixel column widths. */
export function initResizablePanes() {
  const app = document.querySelector<HTMLDivElement>('#app')!;
  const gutter1 = document.querySelector<HTMLDivElement>('#gutter1')!;
  const gutter2 = document.querySelector<HTMLDivElement>('#gutter2')!;

  let sizes = load();

  /** Total pixel width available to the three panes (excludes the two gutters). */
  const paneSpace = () => app.clientWidth - 2 * GUTTER_W;

  // Vars live on :root so the anti-flash head script can set them before #app exists.
  const root = document.documentElement;

  /** Write the current percentages out as pixel column widths. */
  function applyPx() {
    const space = paneSpace();
    let sidebar = (sizes.sidebar / 100) * space;
    let editor = (sizes.editor / 100) * space;
    // Cap the sidebar even on wide viewports; hand the overflow to the editor.
    if (sidebar > MAX_SIDEBAR) {
      editor += sidebar - MAX_SIDEBAR;
      sidebar = MAX_SIDEBAR;
    }
    root.style.setProperty('--col-sidebar', `${sidebar}px`);
    root.style.setProperty('--col-editor', `${editor}px`);
    root.style.setProperty('--col-preview', `${(sizes.preview / 100) * space}px`);
  }

  applyPx();
  // Re-hydrate pixels from the stored percentages when the viewport changes.
  window.addEventListener('resize', applyPx);

  // Drag a gutter: redistribute px between the two adjacent panes, then persist as %.
  function startDrag(
    gutter: HTMLDivElement,
    a: keyof Sizes,
    b: keyof Sizes,
    e: PointerEvent,
    maxA = Infinity
  ) {
    e.preventDefault();
    const space = paneSpace();
    const startX = e.clientX;
    const aPx = (sizes[a] / 100) * space;
    const bPx = (sizes[b] / 100) * space;
    const total = aPx + bPx; // the pair's combined width stays constant
    gutter.classList.add('is-dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    // Capture so pointer events keep coming to the gutter even over the preview
    // iframe (which would otherwise swallow pointerup → the drag would never end).
    gutter.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      const upper = Math.min(total - MIN_PANE, maxA);
      const newA = Math.max(MIN_PANE, Math.min(upper, aPx + delta));
      sizes = { ...sizes, [a]: (newA / space) * 100, [b]: ((total - newA) / space) * 100 };
      applyPx();
    };
    const onUp = () => {
      gutter.classList.remove('is-dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      gutter.removeEventListener('pointermove', onMove);
      gutter.removeEventListener('pointerup', onUp);
      gutter.removeEventListener('pointercancel', onUp);
      save(sizes);
    };
    gutter.addEventListener('pointermove', onMove);
    gutter.addEventListener('pointerup', onUp);
    gutter.addEventListener('pointercancel', onUp);
  }

  gutter1.addEventListener('pointerdown', (e) =>
    startDrag(gutter1, 'sidebar', 'editor', e, MAX_SIDEBAR)
  );
  gutter2.addEventListener('pointerdown', (e) =>
    startDrag(gutter2, 'editor', 'preview', e)
  );
}
