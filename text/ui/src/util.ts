// Petites fonctions sans interface (testées par vitest).

export function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function dirName(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i > 0 ? path.slice(0, i) : i === 0 ? path.slice(0, 1) : "";
}

/** Chemin affiché : le dossier personnel devient « ~ ». */
export function displayPath(path: string, home: string | null): string {
  if (home && (path === home || path.startsWith(home.replace(/[\\/]$/, "") + "/"))) return "~" + path.slice(home.replace(/[\\/]$/, "").length);
  return path;
}

export interface Indent {
  tabs: boolean;
  width: number;
}

/**
 * Indentation d'un texte : tabulations ou espaces, et largeur (la plus
 * fréquente des différences d'indentation entre lignes successives).
 * `null` sans indice (texte sans lignes indentées).
 */
export function detectIndent(text: string, maxLines = 2000): Indent | null {
  let tabLines = 0;
  let spaceLines = 0;
  const deltas = new Map<number, number>();
  let prev = 0;
  let n = 0;
  let start = 0;
  while (start <= text.length && n < maxLines) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end);
    start = end + 1;
    n++;
    if (!line.trim()) continue;
    if (line[0] === "\t") {
      tabLines++;
      prev = 0;
      continue;
    }
    const m = /^ +/.exec(line);
    const width = m ? m[0].length : 0;
    // Suite d'un commentaire en bloc (« * ») : ne compte pas.
    if (width > 0 && /^ +\*/.test(line) && width % 2 === 1) continue;
    if (width > 0) spaceLines++;
    const d = Math.abs(width - prev);
    if (d >= 2) deltas.set(d, (deltas.get(d) ?? 0) + 1);
    prev = width;
  }
  if (!tabLines && !spaceLines) return null;
  if (tabLines > spaceLines) return { tabs: true, width: 0 };
  let best = 0;
  let bestCount = 0;
  for (const [d, c] of deltas) {
    if (d > 8) continue;
    if (c > bestCount || (c === bestCount && d < best)) {
      best = d;
      bestCount = c;
    }
  }
  return best ? { tabs: false, width: best } : null;
}

/** Trie des lignes (ordre naturel, insensible à la casse et aux accents). */
export function sortLines(lines: string[], descending = false): string[] {
  const coll = new Intl.Collator("fr-CA", { numeric: true, sensitivity: "base" });
  const out = [...lines].sort((a, b) => coll.compare(a, b));
  return descending ? out.reverse() : out;
}

/** Retire les espaces en fin de ligne. */
export function trimTrailing(text: string): string {
  return text.replace(/[ \t]+$/gm, "");
}

/** Taille lisible : « 12,4 Mo ». */
export function humanSize(bytes: number): string {
  const units = ["octets", "Ko", "Mo", "Go"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return u === 0 ? `${v} ${units[0]}` : `${v.toLocaleString("fr-CA", { maximumFractionDigits: 1 })} ${units[u]}`;
}

/** Statistiques du texte (Outils → Statistiques). */
export function textStats(text: string): { lines: number; words: number; chars: number; charsNoSpaces: number } {
  const lines = text === "" ? 1 : text.split("\n").length;
  const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) ?? []).length;
  const chars = [...text].length;
  const charsNoSpaces = [...text.replace(/\s/g, "")].length;
  return { lines, words, chars, charsNoSpaces };
}
