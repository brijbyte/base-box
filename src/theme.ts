// Theming has two orthogonal axes:
//  - MODE: 'system' | 'light' | 'dark' — does the UI render light or dark?
//  - COLOR THEME: a palette variant *within* an appearance. Light and dark each have their
//    own set (light: 'default'; dark: 'default' | 'dimmed'). The color theme that applies is
//    the one for the *effective* appearance (mode, or the OS preference when mode='system').
export type Mode = 'system' | 'light' | 'dark';
export type Appearance = 'light' | 'dark';

export interface ColorTheme {
  id: string;
  label: string;
}

/** Available color themes per appearance. `default` is the built-in palette (not persisted). */
export const THEMES: Record<Appearance, ColorTheme[]> = {
  light: [{ id: 'default', label: 'Default' }],
  dark: [
    { id: 'default', label: 'Default' },
    { id: 'dimmed', label: 'Dark Dimmed' },
  ],
};

const MODE_KEY = 'base-box-theme';
const THEME_KEY: Record<Appearance, string> = {
  light: 'base-box-light-theme',
  dark: 'base-box-dark-theme',
};

const MODES: Mode[] = ['system', 'light', 'dark'];
const darkMql = () => window.matchMedia('(prefers-color-scheme: dark)');

export function getMode(): Mode {
  const m = localStorage.getItem(MODE_KEY) as Mode | null;
  return m && MODES.includes(m) ? m : 'system';
}

/** The appearance that's actually showing — resolves 'system' against the OS preference. */
export function effectiveAppearance(): Appearance {
  const mode = getMode();
  if (mode !== 'system') return mode;
  return darkMql().matches ? 'dark' : 'light';
}

/** The selected color theme id for an appearance (falls back to 'default'). */
export function getColorTheme(appearance: Appearance): string {
  const id = localStorage.getItem(THEME_KEY[appearance]);
  return id && THEMES[appearance].some((t) => t.id === id) ? id : 'default';
}

/** Reflect all axes onto <html>: data-theme (mode) + data-{light,dark}-theme (palettes). */
export function applyTheme(): void {
  const root = document.documentElement;
  const mode = getMode();
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  root.setAttribute('data-light-theme', getColorTheme('light'));
  root.setAttribute('data-dark-theme', getColorTheme('dark'));
}

export function setMode(mode: Mode): void {
  localStorage.setItem(MODE_KEY, mode);
  applyTheme();
}

/** Persist a color theme for an appearance. 'default' is the absence of an override, so its
 *  key is removed rather than stored. */
export function setColorTheme(appearance: Appearance, id: string): void {
  if (id === 'default') localStorage.removeItem(THEME_KEY[appearance]);
  else localStorage.setItem(THEME_KEY[appearance], id);
  applyTheme();
}

/** Run `cb` whenever the OS light/dark preference flips (only matters while mode='system'). */
export function onSystemAppearanceChange(cb: () => void): void {
  darkMql().addEventListener('change', cb);
}

/** Apply persisted theming on boot. */
export function initTheme(): void {
  applyTheme();
}
