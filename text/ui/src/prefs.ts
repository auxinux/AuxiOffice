// Préférences d'AuxiText (fichier `preferences.json` du dossier de
// configuration). Tout ce qui est lu est vérifié : un fichier abîmé ou d'une
// autre version redonne les valeurs par défaut champ par champ.

export type ThemePref = "system" | "light" | "dark";

export interface Prefs {
  theme: ThemePref;
  /** Police ; vide = police à chasse fixe du système. */
  fontFamily: string;
  fontSize: number;
  /** Zoom (Ctrl+molette, Ctrl+±), multiplie la taille de police. */
  zoom: number;
  wrap: boolean;
  lineNumbers: boolean;
  highlightLine: boolean;
  showWhitespace: boolean;
  indentWithTabs: boolean;
  indentWidth: number;
  /** Indentation déduite du contenu de chaque fichier ouvert. */
  detectIndent: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  theme: "system",
  fontFamily: "",
  fontSize: 14,
  zoom: 1,
  wrap: true,
  lineNumbers: true,
  highlightLine: true,
  showWhitespace: false,
  indentWithTabs: false,
  indentWidth: 4,
  detectIndent: true,
};

export const FONT_SIZES = { min: 6, max: 72 };
export const ZOOM = { min: 0.5, max: 4, step: 0.1 };
export const INDENT_WIDTHS = [2, 3, 4, 8];

export const DEFAULT_FONT = 'ui-monospace, "Hack", "Noto Sans Mono", "DejaVu Sans Mono", "Liberation Mono", "Cascadia Mono", Menlo, Consolas, monospace';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function sanitizePrefs(raw: unknown): Prefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const p: Prefs = { ...DEFAULT_PREFS };
  if (r.theme === "system" || r.theme === "light" || r.theme === "dark") p.theme = r.theme;
  if (typeof r.fontFamily === "string") p.fontFamily = r.fontFamily.replace(/[;{}<>]/g, "").trim().slice(0, 200);
  if (typeof r.fontSize === "number" && Number.isFinite(r.fontSize)) p.fontSize = clamp(Math.round(r.fontSize), FONT_SIZES.min, FONT_SIZES.max);
  if (typeof r.zoom === "number" && Number.isFinite(r.zoom)) p.zoom = roundZoom(clamp(r.zoom, ZOOM.min, ZOOM.max));
  for (const k of ["wrap", "lineNumbers", "highlightLine", "showWhitespace", "indentWithTabs", "detectIndent"] as const) {
    if (typeof r[k] === "boolean") p[k] = r[k] as boolean;
  }
  if (typeof r.indentWidth === "number" && Number.isInteger(r.indentWidth)) p.indentWidth = clamp(r.indentWidth, 1, 16);
  return p;
}

const roundZoom = (z: number) => Math.round(z * 10) / 10;

/** Zoom suivant (`dir` = +1, -1) ou normal (0). */
export function nextZoom(zoom: number, dir: -1 | 0 | 1): number {
  if (dir === 0) return 1;
  return roundZoom(clamp(zoom + dir * ZOOM.step, ZOOM.min, ZOOM.max));
}

/** Taille de police affichée, en pixels. */
export function effectiveFontSize(p: Prefs): number {
  return Math.round(p.fontSize * p.zoom * 10) / 10;
}

export function fontStack(p: Prefs): string {
  if (!p.fontFamily) return DEFAULT_FONT;
  const name = /[\s,"']/.test(p.fontFamily) && !p.fontFamily.includes(",") ? `"${p.fontFamily.replace(/"/g, "")}"` : p.fontFamily;
  return `${name}, ${DEFAULT_FONT}`;
}

/** Thème appliqué : choix forcé, sinon celui du bureau (inconnu = clair). */
export function isDark(theme: ThemePref, systemDark: boolean | null): boolean {
  return theme === "dark" || (theme === "system" && systemDark === true);
}
