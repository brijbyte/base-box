export type Theme = 'system' | 'light' | 'dark';

const KEY = 'base-box-theme';
const ORDER: Theme[] = ['system', 'light', 'dark'];

export function getTheme(): Theme {
  const t = localStorage.getItem(KEY);
  return t === 'light' || t === 'dark' ? t : 'system';
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

/** Cycle System → Light → Dark → System and persist. Returns the new theme. */
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

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

/** Whether the given theme resolves to dark right now (system → ask the OS). */
export function isDark(theme: Theme): boolean {
  return theme === 'dark' || (theme === 'system' && darkQuery().matches);
}

/** Notify when the OS color scheme changes (relevant only in 'system' mode). */
export function onSystemThemeChange(cb: () => void): void {
  darkQuery().addEventListener('change', cb);
}
