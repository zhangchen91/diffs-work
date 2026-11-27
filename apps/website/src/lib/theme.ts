/**
 * Three themes, one token set.
 *
 * Every colour the site draws comes from these variables; components must not use
 * a raw light-dark pair (`text-white`, `bg-slate-800`) because that is exactly
 * what froze the old UI into a single palette. Tailwind v4 lets a utility read a
 * variable, so `bg-panel` → `var(--color-panel)` follows the theme automatically.
 *
 *   obsidian  — the original near-black slate (default, dark)
 *   paper     — light theme for printing and long reading
 *   forest    — deep green, low glare, tuned for legal/finance reading at night
 */

export type ThemeId = "obsidian" | "paper" | "forest";

export interface ThemeMeta {
  id: ThemeId;
  /** message key */
  label: string;
  /** message key */
  hint: string;
  /** browser chrome colour while this theme is active */
  scheme: "dark" | "light";
  swatch: [string, string, string];
}

export const THEMES: ThemeMeta[] = [
  { id: "obsidian", label: "theme.obsidian", hint: "theme.obsidian.hint", scheme: "dark", swatch: ["#05060a", "#11141c", "#6ee7b7"] },
  { id: "paper", label: "theme.paper", hint: "theme.paper.hint", scheme: "light", swatch: ["#fbfaf7", "#f1eee7", "#0f766e"] },
  { id: "forest", label: "theme.forest", hint: "theme.forest.hint", scheme: "dark", swatch: ["#06120e", "#0d1f19", "#7ee2a8"] },
];

export const DEFAULT_THEME: ThemeId = "obsidian";
export const THEME_STORAGE_KEY = "diffs.theme";

export function isTheme(v: unknown): v is ThemeId {
  return v === "obsidian" || v === "paper" || v === "forest";
}

/** Apply a theme to <html>: class for CSS, `color-scheme` for form controls. */
export function applyTheme(id: ThemeId, doc: Document = document): void {
  const meta = THEMES.find((t) => t.id === id) ?? THEMES[0];
  const root = doc.documentElement;
  for (const t of THEMES) root.classList.toggle(`theme-${t.id}`, t.id === meta.id);
  root.style.colorScheme = meta.scheme;
  const metaTag = doc.querySelector('meta[name="theme-color"]');
  if (metaTag) metaTag.setAttribute("content", meta.swatch[0]);
}

export function loadTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(saved)) return saved;
  } catch {
    /* private mode */
  }
  // first visit: follow the OS, but never leave the designed default
  return DEFAULT_THEME;
}

export function rememberTheme(id: ThemeId): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}