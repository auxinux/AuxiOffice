// Encodages proposés (noms compris par la coque, voir textio.rs) et fins de ligne.

export type Eol = "lf" | "crlf" | "cr";

export interface EncodingDef {
  /** Nom transmis à la coque. */
  encoding: string;
  bom: boolean;
  label: string;
}

export const ENCODINGS: EncodingDef[] = [
  { encoding: "UTF-8", bom: false, label: "UTF-8" },
  { encoding: "UTF-8", bom: true, label: "UTF-8 avec BOM" },
  { encoding: "UTF-16LE", bom: true, label: "UTF-16 LE" },
  { encoding: "UTF-16BE", bom: true, label: "UTF-16 BE" },
  { encoding: "windows-1252", bom: false, label: "Occidental (Windows-1252)" },
  { encoding: "ISO-8859-1", bom: false, label: "Occidental (ISO-8859-1)" },
  { encoding: "ISO-8859-15", bom: false, label: "Occidental (ISO-8859-15)" },
  { encoding: "macintosh", bom: false, label: "Occidental (Mac Roman)" },
  { encoding: "windows-1250", bom: false, label: "Europe centrale (Windows-1250)" },
  { encoding: "ISO-8859-2", bom: false, label: "Europe centrale (ISO-8859-2)" },
  { encoding: "windows-1251", bom: false, label: "Cyrillique (Windows-1251)" },
  { encoding: "KOI8-R", bom: false, label: "Cyrillique (KOI8-R)" },
  { encoding: "windows-1253", bom: false, label: "Grec (Windows-1253)" },
  { encoding: "windows-1254", bom: false, label: "Turc (Windows-1254)" },
  { encoding: "windows-1255", bom: false, label: "Hébreu (Windows-1255)" },
  { encoding: "windows-1256", bom: false, label: "Arabe (Windows-1256)" },
  { encoding: "windows-1257", bom: false, label: "Balte (Windows-1257)" },
  { encoding: "windows-874", bom: false, label: "Thaï (Windows-874)" },
  { encoding: "Shift_JIS", bom: false, label: "Japonais (Shift_JIS)" },
  { encoding: "EUC-JP", bom: false, label: "Japonais (EUC-JP)" },
  { encoding: "GBK", bom: false, label: "Chinois simplifié (GBK)" },
  { encoding: "gb18030", bom: false, label: "Chinois simplifié (GB18030)" },
  { encoding: "Big5", bom: false, label: "Chinois traditionnel (Big5)" },
  { encoding: "EUC-KR", bom: false, label: "Coréen (EUC-KR)" },
];

export function encodingKey(encoding: string, bom: boolean): string {
  return `${encoding.toLowerCase()}|${bom ? 1 : 0}`;
}

/** Libellé court pour la barre d'état. */
export function encodingLabel(encoding: string, bom: boolean): string {
  const e = encoding.toUpperCase();
  if (e === "UTF-8") return bom ? "UTF-8 avec BOM" : "UTF-8";
  if (e === "UTF-16LE" || e === "UTF-16BE") return `UTF-16 ${e.slice(6)}${bom ? "" : " sans BOM"}`;
  if (encoding === "macintosh") return "Mac Roman";
  return encoding.replace(/^windows-/i, "Windows-");
}

export const EOLS: { id: Eol; label: string; short: string }[] = [
  { id: "lf", label: "LF (Linux, macOS)", short: "LF" },
  { id: "crlf", label: "CRLF (Windows)", short: "CRLF" },
  { id: "cr", label: "CR (ancien Mac OS)", short: "CR" },
];

export function eolShort(eol: Eol): string {
  return EOLS.find((e) => e.id === eol)?.short ?? "LF";
}
