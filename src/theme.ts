export type Theme = 'system' | 'light' | 'dark' | 'dark-dimmed';

const KEY = 'base-box-theme';
const ORDER: Theme[] = ['system', 'light', 'dark', 'dark-dimmed'];

/** Non-default themes set `data-theme` to this exact value; `system` clears it. */
export const OVERRIDE_THEMES: Theme[] = ['light', 'dark', 'dark-dimmed'];

const LABELS: Record<Theme, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
  'dark-dimmed': 'Dark Dimmed',
};

export const themeLabel = (t: Theme) => `Theme: ${LABELS[t]}`;

export function getTheme(): Theme {
  const t = localStorage.getItem(KEY) as Theme | null;
  return t && OVERRIDE_THEMES.includes(t) ? t : 'system';
}

/** Apply a theme: 'system' clears the override so CSS `prefers-color-scheme` wins. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}

/** Cycle System → Light → Dark → Dark Dimmed → System and persist. Returns the new theme. */
export function cycleTheme(): Theme {
  const next = ORDER[(ORDER.indexOf(getTheme()) + 1) % ORDER.length];
  setTheme(next);
  return next;
}

/** Initialize from storage and return the active theme. */
export function initTheme(): Theme {
  const t = getTheme();
  applyTheme(t);
  return t;
}
