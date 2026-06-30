// Theming has two orthogonal axes:
//  - MODE: 'system' | 'light' | 'dark'  (does the UI render light or dark?)
//  - COLOR THEME: a palette variant within a mode. Dark currently has 'default' | 'dimmed';
//    a dark color theme only applies when the effective mode is dark (explicit dark, or
//    system + OS-dark). Light has only 'default' for now but mirrors the same shape.
export type Mode = 'system' | 'light' | 'dark';
export type DarkTheme = 'default' | 'dimmed';

const MODE_KEY = 'base-box-theme';
const DARK_KEY = 'base-box-dark-theme';

const MODES: Mode[] = ['system', 'light', 'dark'];
const DARK_THEMES: DarkTheme[] = ['default', 'dimmed'];

export const MODE_LABELS: Record<Mode, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};
export const DARK_THEME_LABELS: Record<DarkTheme, string> = {
  default: 'Default',
  dimmed: 'Dark Dimmed',
};

export function getMode(): Mode {
  const m = localStorage.getItem(MODE_KEY) as Mode | null;
  return m && MODES.includes(m) ? m : 'system';
}

export function getDarkTheme(): DarkTheme {
  const d = localStorage.getItem(DARK_KEY) as DarkTheme | null;
  return d && DARK_THEMES.includes(d) ? d : 'default';
}

/** Reflect both axes onto <html>: data-theme (mode; 'system' clears it) + data-dark-theme. */
export function applyTheme(mode = getMode(), darkTheme = getDarkTheme()): void {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  root.setAttribute('data-dark-theme', darkTheme);
}

export function setMode(mode: Mode): void {
  localStorage.setItem(MODE_KEY, mode);
  applyTheme(mode, getDarkTheme());
}

export function setDarkTheme(darkTheme: DarkTheme): void {
  localStorage.setItem(DARK_KEY, darkTheme);
  applyTheme(getMode(), darkTheme);
}

/** Initialize from storage and return the active mode + dark color theme. */
export function initTheme(): { mode: Mode; darkTheme: DarkTheme } {
  const mode = getMode();
  const darkTheme = getDarkTheme();
  applyTheme(mode, darkTheme);
  return { mode, darkTheme };
}
