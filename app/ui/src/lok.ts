// Conversions entre l'interface et LibreOfficeKit : unités, rectangles des
// rappels, codes de touches. Fonctions pures, testées dans lok.test.ts.

/** Twips par pixel CSS à 100 % (1 pouce = 1440 twips = 96 px). */
export const TWIPS_PER_PX = 15;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** « x, y, w, h » ou « x, y, w, h; x, y, w, h » ; « EMPTY » = aucun. */
export function parseRects(payload: string): Rect[] {
  const p = payload.trim();
  if (!p || p === "EMPTY") return [];
  const out: Rect[] = [];
  for (const part of p.split(";")) {
    const n = part.split(",").map((v) => Number(v.trim()));
    if (n.length >= 4 && n.slice(0, 4).every(Number.isFinite)) {
      out.push({ x: n[0], y: n[1], w: n[2], h: n[3] });
    }
  }
  return out;
}

export interface Invalidation {
  /** null = tout le document. */
  rect: Rect | null;
  part: number | null;
}

/** Rappel invalidate_tiles : « EMPTY[, part] » ou « x, y, w, h[, part[, mode]] ». */
export function parseInvalidation(payload: string): Invalidation {
  const fields = payload.split(",").map((s) => s.trim());
  if (fields[0] === "EMPTY") {
    const part = fields.length > 1 ? Number(fields[1]) : NaN;
    return { rect: null, part: Number.isFinite(part) ? part : null };
  }
  const n = fields.map(Number);
  if (n.length < 4 || !n.slice(0, 4).every(Number.isFinite)) return { rect: null, part: null };
  // LibreOffice signale « tout » avec des valeurs immenses.
  const huge = n[2] >= 1e9 || n[3] >= 1e9;
  return {
    rect: huge ? null : { x: n[0], y: n[1], w: n[2], h: n[3] },
    part: n.length > 4 && Number.isFinite(n[4]) ? n[4] : null,
  };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Rappel state_changed : « .uno:Bold=true » ou objet JSON {commandName, state}. */
export function parseState(payload: string): { command: string; value: string } | null {
  const p = payload.trim();
  if (p.startsWith("{")) {
    try {
      const j = JSON.parse(p);
      if (typeof j.commandName === "string") {
        return { command: j.commandName, value: typeof j.state === "string" ? j.state : JSON.stringify(j.state ?? "") };
      }
    } catch {
      /* charge utile ignorée */
    }
    return null;
  }
  const i = p.indexOf("=");
  if (i <= 0) return null;
  return { command: p.slice(0, i), value: p.slice(i + 1) };
}

// Codes de touches VCL (com::sun::star::awt::Key).
export const KEY = {
  NUM0: 256,
  A: 512,
  F1: 768,
  DOWN: 1024,
  UP: 1025,
  LEFT: 1026,
  RIGHT: 1027,
  HOME: 1028,
  END: 1029,
  PAGEUP: 1030,
  PAGEDOWN: 1031,
  RETURN: 1280,
  ESCAPE: 1281,
  TAB: 1282,
  BACKSPACE: 1283,
  SPACE: 1284,
  INSERT: 1285,
  DELETE: 1286,
  SHIFT: 0x1000,
  MOD1: 0x2000,
  MOD2: 0x4000,
  MOD3: 0x8000,
} as const;

const NAMED: Record<string, number> = {
  ArrowDown: KEY.DOWN,
  ArrowUp: KEY.UP,
  ArrowLeft: KEY.LEFT,
  ArrowRight: KEY.RIGHT,
  Home: KEY.HOME,
  End: KEY.END,
  PageUp: KEY.PAGEUP,
  PageDown: KEY.PAGEDOWN,
  Enter: KEY.RETURN,
  NumpadEnter: KEY.RETURN,
  Escape: KEY.ESCAPE,
  Tab: KEY.TAB,
  Backspace: KEY.BACKSPACE,
  Insert: KEY.INSERT,
  Delete: KEY.DELETE,
};

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export interface LokKey {
  char: number;
  code: number;
}

/**
 * Touche à transmettre telle quelle au moteur (navigation, édition,
 * raccourcis), ou null si c'est un caractère ordinaire : celui-ci passe par
 * l'événement de saisie de texte, qui gère accents et méthodes de saisie.
 */
export function lokKeyFor(e: KeyLike, mac = false): LokKey | null {
  const primary = mac ? e.metaKey : e.ctrlKey;
  let mods = 0;
  if (e.shiftKey) mods |= KEY.SHIFT;
  if (primary) mods |= KEY.MOD1;
  if (e.altKey) mods |= KEY.MOD2;
  if (mac && e.ctrlKey) mods |= KEY.MOD3;

  const named = NAMED[e.key] ?? NAMED[e.code];
  if (named !== undefined) {
    const char = named === KEY.RETURN ? 13 : named === KEY.TAB ? 9 : named === KEY.BACKSPACE ? 8 : named === KEY.ESCAPE ? 27 : 0;
    return { char, code: named | mods };
  }
  const fn = /^F([1-9]|1[0-2])$/.exec(e.key);
  if (fn) return { char: 0, code: (KEY.F1 + Number(fn[1]) - 1) | mods };

  // Raccourcis avec Ctrl/Cmd ou Alt : code physique de la lettre ou du chiffre.
  if (primary || (mac && e.ctrlKey) || (e.altKey && !e.ctrlKey)) {
    const letter = /^Key([A-Z])$/.exec(e.code);
    if (letter) return { char: 0, code: (KEY.A + letter[1].charCodeAt(0) - 65) | mods };
    const digit = /^Digit([0-9])$/.exec(e.code);
    if (digit) return { char: 0, code: (KEY.NUM0 + Number(digit[1])) | mods };
    if (e.key === " ") return { char: 32, code: KEY.SPACE | mods };
  }
  return null;
}

/** Couleur CSS « #rrggbb » vers l'entier attendu par .uno:Color. */
export function colorToLong(css: string): number {
  return parseInt(css.replace("#", ""), 16) & 0xffffff;
}

/** Arguments UNO typés pour postUnoCommand. */
export function unoArgs(values: Record<string, string | number | boolean>): Record<string, { type: string; value: unknown }> {
  const out: Record<string, { type: string; value: unknown }> = {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === "boolean") out[k] = { type: "boolean", value: v };
    else if (typeof v === "number") out[k] = Number.isInteger(v) ? { type: "long", value: v } : { type: "float", value: v };
    else out[k] = { type: "string", value: v };
  }
  return out;
}

/** Extension → format d'enregistrement LibreOfficeKit. */
export function formatForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return ext;
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Document vierge pas encore enregistré par l'utilisateur. */
export function isUntitled(path: string): boolean {
  return /[\\/]AuxiOffice[\\/]Sans titre \d+\.\w+$/.test(path);
}

/** Chemin local → URL file:// (Windows : file:///C:/…). */
export function toFileUrl(path: string): string {
  let p = path.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(p)) p = "/" + p;
  return "file://" + p.split("/").map(encodeURIComponent).join("/").replace(/^\/([A-Za-z])%3A/, "/$1:");
}
