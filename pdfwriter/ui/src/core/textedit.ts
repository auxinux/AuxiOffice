// Modification du texte existant d'un PDF : le flux de contenu de la page est
// interprété (matrices, état du texte, polices) pour retrouver chaque suite de
// glyphes ; une modification réécrit directement ces instructions. L'ancien
// texte disparaît donc vraiment du fichier, et rien d'autre ne change : les
// octets qui ne sont pas concernés sont conservés tels quels.
//
// La police d'origine est réutilisée quand elle contient tous les caractères
// (une police incorporée n'a souvent que les glyphes utilisés) ; sinon le texte
// est écrit avec la police standard la plus proche.

import { Encodings, Font, type IFontNames } from "@pdf-lib/standard-fonts";
import { decodePDFRawStream, degrees, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFPage, PDFRawStream, PDFRef, PDFStream, rgb } from "pdf-lib";
import { type FontFamily, standardFontName, unsupportedChar } from "./objects";
import { type Bytes, CoreError, fitWinAnsi, openDoc, type Rgb, saveDoc } from "./pages";

// --- Lecture du flux de contenu ---------------------------------------------------

type Operand = number | string | { name: string } | { str: Uint8Array } | Operand[] | null;

export interface Instr {
  op: string;
  args: Operand[];
  start: number;
  end: number;
}

const isSpace = (c: number) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const isDelim = (c: number) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;

export function parseContent(b: Uint8Array): Instr[] {
  let i = 0;
  const n = b.length;
  const skip = () => {
    while (i < n) {
      if (isSpace(b[i])) i++;
      else if (b[i] === 37) {
        while (i < n && b[i] !== 10 && b[i] !== 13) i++;
      } else break;
    }
  };
  const hexVal = (c: number) => (c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1);
  const literal = (): { str: Uint8Array } => {
    i++;
    const out: number[] = [];
    let depth = 1;
    while (i < n) {
      let c = b[i++];
      if (c === 92) {
        c = b[i++];
        const map: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 };
        if (map[c] !== undefined) out.push(map[c]);
        else if (c >= 48 && c <= 55) {
          let v = c - 48;
          for (let k = 0; k < 2 && b[i] >= 48 && b[i] <= 55; k++) v = v * 8 + b[i++] - 48;
          out.push(v & 255);
        } else if (c === 13) {
          if (b[i] === 10) i++;
        } else if (c !== 10) out.push(c);
        continue;
      }
      if (c === 40) depth++;
      else if (c === 41 && --depth === 0) break;
      out.push(c);
    }
    return { str: Uint8Array.from(out) };
  };
  const hex = (): { str: Uint8Array } => {
    i++;
    const out: number[] = [];
    let high = -1;
    while (i < n && b[i] !== 62) {
      const v = hexVal(b[i++]);
      if (v < 0) continue;
      if (high < 0) high = v;
      else {
        out.push(high * 16 + v);
        high = -1;
      }
    }
    i++;
    if (high >= 0) out.push(high * 16);
    return { str: Uint8Array.from(out) };
  };
  const value = (): Operand | undefined => {
    skip();
    if (i >= n) return undefined;
    const c = b[i];
    if (c === 40) return literal();
    if (c === 60 && b[i + 1] === 60) {
      i += 2;
      let depth = 1;
      while (i < n && depth > 0) {
        if (b[i] === 60 && b[i + 1] === 60) (depth++, (i += 2));
        else if (b[i] === 62 && b[i + 1] === 62) (depth--, (i += 2));
        else if (b[i] === 40) literal();
        else i++;
      }
      return null;
    }
    if (c === 60) return hex();
    if (c === 91) {
      i++;
      const arr: Operand[] = [];
      for (;;) {
        skip();
        if (i >= n) break;
        if (b[i] === 93) {
          i++;
          break;
        }
        const v = value();
        if (v === undefined) break;
        arr.push(v);
      }
      return arr;
    }
    if (c === 47) {
      i++;
      const s = i;
      while (i < n && !isSpace(b[i]) && !isDelim(b[i])) i++;
      return { name: String.fromCharCode(...b.subarray(s, i)) };
    }
    if (isDelim(c)) {
      i++;
      return null;
    }
    const s = i;
    while (i < n && !isSpace(b[i]) && !isDelim(b[i])) i++;
    const tok = String.fromCharCode(...b.subarray(s, i));
    if (/^[+-]?(\d+\.?\d*|\.\d+)/.test(tok)) return parseFloat(tok);
    return tok;
  };

  const out: Instr[] = [];
  let args: Operand[] = [];
  let start = -1;
  for (;;) {
    skip();
    if (i >= n) break;
    if (start < 0) start = i;
    const v = value();
    if (v === undefined) break;
    if (typeof v === "string") {
      if (v === "true" || v === "false" || v === "null") {
        args.push(v);
        continue;
      }
      if (v === "BI") {
        // Image en ligne : données binaires jusqu'à « EI » isolé.
        const id = findSeq(b, i, "ID");
        let e = id < 0 ? n : id + 2;
        for (; e < n - 1; e++) {
          if (b[e] === 69 && b[e + 1] === 73 && isSpace(b[e - 1]) && (e + 2 >= n || isSpace(b[e + 2]))) break;
        }
        i = Math.min(n, e + 2);
        out.push({ op: "BI", args: [], start, end: i });
      } else {
        out.push({ op: v, args, start, end: i });
      }
      args = [];
      start = -1;
    } else args.push(v);
  }
  return out;
}

function findSeq(b: Uint8Array, from: number, s: string): number {
  const [x, y] = [s.charCodeAt(0), s.charCodeAt(1)];
  for (let i = from; i < b.length - 1; i++) if (b[i] === x && b[i + 1] === y && (isSpace(b[i - 1]) || isDelim(b[i - 1])) && isSpace(b[i + 2] ?? 32)) return i;
  return -1;
}

// --- Polices --------------------------------------------------------------------------

export interface FontInfo {
  baseFont: string;
  codeLen: 1 | 2;
  /** Code → texte ; absent : caractère inconnu. */
  toUni: Map<number, string>;
  fromUni: Map<string, number>;
  widthOf(code: number): number;
  subsetUnreliable: boolean;
  seen: Set<string>;
  family: FontFamily;
  bold: boolean;
  italic: boolean;
}

const WIN = new Map<number, { uni: string; name: string }>();
const NAME_TO_UNI = new Map<string, string>([
  ["fi", "fi"], ["fl", "fl"], ["ff", "ff"], ["ffi", "ffi"], ["ffl", "ffl"], ["nbspace", " "], ["sfthyphen", "­"], ["space", " "],
]);
for (const cp of Encodings.WinAnsi.supportedCodePoints) {
  const { code, name } = Encodings.WinAnsi.encodeUnicodeCodePoint(cp);
  const uni = String.fromCodePoint(cp);
  if (!WIN.has(code)) WIN.set(code, { uni, name });
  if (!NAME_TO_UNI.has(name)) NAME_TO_UNI.set(name, uni);
}

function glyphToUni(name: string): string | undefined {
  const known = NAME_TO_UNI.get(name);
  if (known) return known;
  let m = /^uni([0-9A-Fa-f]{4})/.exec(name);
  if (m) return String.fromCharCode(parseInt(m[1], 16));
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  const dot = name.indexOf(".");
  return dot > 0 ? glyphToUni(name.slice(0, dot)) : undefined;
}

function streamBytes(s: unknown): Uint8Array | null {
  if (s instanceof PDFRawStream) return decodePDFRawStream(s).decode();
  if (s instanceof PDFStream) return s.getContents();
  return null;
}

function parseToUnicode(data: Uint8Array): Map<number, string> {
  const map = new Map<number, string>();
  const text = new TextDecoder("latin1").decode(data);
  const hexStr = (h: string) => {
    let s = "";
    for (let i = 0; i + 3 < h.length; i += 4) s += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
    if (h.length === 2) s = String.fromCharCode(parseInt(h, 16));
    return s;
  };
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]*)>/g)) {
      map.set(parseInt(m[1].replace(/\s/g, ""), 16), hexStr(m[2].replace(/\s/g, "")));
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f\s]*)>|\[([^\]]*)\])/g)) {
      const a = parseInt(m[1], 16);
      const b = parseInt(m[2], 16);
      if (b - a > 65535) continue;
      if (m[3] !== undefined) {
        const base = m[3].replace(/\s/g, "");
        const lastUnit = parseInt(base.slice(-4), 16);
        const prefix = hexStr(base.slice(0, -4));
        for (let c = a; c <= b; c++) map.set(c, prefix + String.fromCharCode(lastUnit + c - a));
      } else {
        [...m[4].matchAll(/<([0-9A-Fa-f\s]*)>/g)].forEach((d, k) => map.set(a + k, hexStr(d[1].replace(/\s/g, ""))));
      }
    }
  }
  return map;
}

function classify(name: string, flags: number) {
  const n = name.replace(/^[A-Z]{6}\+/, "");
  const family: FontFamily = /cour|mono|consol|typewriter|cmtt|\bfixed/i.test(n) || flags & 1 ? "Courier" : /times|serif(?!.*sans)|roman|georgia|garamond|cambria|minion|palatino|book|cmr|sfrm|lmroman|liberation\s*serif/i.test(n) && !/sans/i.test(n) ? "Times" : flags & 2 && !/sans|arial|helvet/i.test(n) ? "Times" : "Helvetica";
  return {
    family,
    bold: /bold|black|heavy|semibold|demi|cmbx/i.test(n) || !!(flags & 0x40000),
    italic: /ital|obli|cmti/i.test(n) || !!(flags & 64),
  };
}

const STD_ALIASES: [RegExp, string][] = [
  [/^(Arial|Helvetica)(MT)?(,|-)?Bold(Italic|Oblique)/i, "Helvetica-BoldOblique"],
  [/^(Arial|Helvetica)(MT)?(,|-)?Bold/i, "Helvetica-Bold"],
  [/^(Arial|Helvetica)(MT)?(,|-)?(Italic|Oblique)/i, "Helvetica-Oblique"],
  [/^(Arial|Helvetica)/i, "Helvetica"],
  [/^Times.*Bold.*(Italic|Oblique)/i, "Times-BoldItalic"],
  [/^Times.*Bold/i, "Times-Bold"],
  [/^Times.*(Italic|Oblique)/i, "Times-Italic"],
  [/^Times/i, "Times-Roman"],
  [/^Courier.*Bold.*(Italic|Oblique)/i, "Courier-BoldOblique"],
  [/^Courier.*Bold/i, "Courier-Bold"],
  [/^Courier.*(Italic|Oblique)/i, "Courier-Oblique"],
  [/^Courier/i, "Courier"],
];

function loadFont(doc: PDFDocument, dict: PDFDict): FontInfo {
  const ctx = doc.context;
  const nameOf = (v: unknown) => (v instanceof PDFName ? v.decodeText() : "");
  const get = (d: PDFDict, k: string) => ctx.lookup(d.get(PDFName.of(k)));
  const subtype = nameOf(get(dict, "Subtype"));
  const baseFont = nameOf(get(dict, "BaseFont")) || "Inconnue";
  const toUni = new Map<number, string>();
  const tu = streamBytes(get(dict, "ToUnicode"));
  const hasToUnicode = !!tu;
  if (tu) for (const [k, v] of parseToUnicode(tu)) toUni.set(k, v);
  const enc = get(dict, "Encoding");

  let flags = 0;
  let widthOf: (code: number) => number;
  let codeLen: 1 | 2 = 1;
  let embedded = false;
  const descOf = (d: PDFDict) => {
    const fd = get(d, "FontDescriptor");
    if (fd instanceof PDFDict) {
      const f = get(fd, "Flags");
      if (f instanceof PDFNumber) flags = f.asNumber();
      embedded = ["FontFile", "FontFile2", "FontFile3"].some((k) => fd.has(PDFName.of(k)));
      const mw = get(fd, "MissingWidth");
      return mw instanceof PDFNumber ? mw.asNumber() : 0;
    }
    return 0;
  };

  if (subtype === "Type0") {
    codeLen = 2;
    const arr = get(dict, "DescendantFonts");
    const cid = arr instanceof PDFArray ? ctx.lookup(arr.get(0)) : null;
    const widths = new Map<number, number>();
    let dw = 1000;
    if (cid instanceof PDFDict) {
      descOf(cid);
      const d = get(cid, "DW");
      if (d instanceof PDFNumber) dw = d.asNumber();
      const w = get(cid, "W");
      if (w instanceof PDFArray) {
        const items = w.asArray().map((x) => ctx.lookup(x));
        for (let i = 0; i < items.length; ) {
          const a = items[i];
          const b = items[i + 1];
          if (!(a instanceof PDFNumber)) break;
          if (b instanceof PDFArray) {
            b.asArray().forEach((x, k) => {
              const v = ctx.lookup(x);
              if (v instanceof PDFNumber) widths.set(a.asNumber() + k, v.asNumber());
            });
            i += 2;
          } else if (b instanceof PDFNumber && items[i + 2] instanceof PDFNumber) {
            const v = (items[i + 2] as PDFNumber).asNumber();
            for (let c = a.asNumber(); c <= b.asNumber() && c - a.asNumber() < 70000; c++) widths.set(c, v);
            i += 3;
          } else break;
        }
      }
    }
    widthOf = (c) => widths.get(c) ?? dw;
  } else {
    // Encodage simple : table de base, puis /Differences.
    let baseName = "";
    const diffs: [number, string][] = [];
    if (enc instanceof PDFName) baseName = enc.decodeText();
    else if (enc instanceof PDFDict) {
      baseName = nameOf(get(enc, "BaseEncoding"));
      const dArr = get(enc, "Differences");
      if (dArr instanceof PDFArray) {
        let code = 0;
        for (const raw of dArr.asArray()) {
          const v = ctx.lookup(raw);
          if (v instanceof PDFNumber) code = v.asNumber();
          else if (v instanceof PDFName) diffs.push([code++, v.decodeText()]);
        }
      }
    }
    const missing = descOf(dict);
    const std = STD_ALIASES.find(([re]) => re.test(baseFont.replace(/^[A-Z]{6}\+/, "")))?.[1];
    const isSymbolic = /symbol|zapf|dingbat|wingding/i.test(baseFont);
    const names = new Map<number, string>();
    if (!isSymbolic) {
      for (const [code, { uni, name }] of WIN) {
        names.set(code, name);
        if (!tu) toUni.set(code, uni);
      }
      if (baseName === "MacRomanEncoding") {
        const dec = new TextDecoder("macintosh");
        for (let c = 128; c < 256; c++) {
          const uni = dec.decode(Uint8Array.of(c));
          names.delete(c);
          if (!tu) toUni.set(c, uni);
        }
      }
    }
    for (const [code, name] of diffs) {
      names.set(code, name);
      if (!tu) {
        const u = glyphToUni(name);
        if (u) toUni.set(code, u);
        else toUni.delete(code);
      }
    }
    const first = get(dict, "FirstChar");
    const ws = get(dict, "Widths");
    const fm = get(dict, "FontMatrix");
    let unit = 1;
    if (subtype === "Type3" && fm instanceof PDFArray) {
      const a = ctx.lookup(fm.get(0));
      if (a instanceof PDFNumber) unit = a.asNumber() * 1000;
    }
    if (ws instanceof PDFArray && first instanceof PDFNumber) {
      const f = first.asNumber();
      const list = ws.asArray().map((x) => {
        const v = ctx.lookup(x);
        return v instanceof PDFNumber ? v.asNumber() * unit : 0;
      });
      widthOf = (c) => (c >= f && c - f < list.length ? list[c - f] : missing);
    } else {
      const afm = Font.load((std ?? "Helvetica") as IFontNames);
      widthOf = (c) => Number(afm.getWidthOfGlyph(names.get(c) ?? "space") ?? 500);
    }
  }

  const fromUni = new Map<string, number>();
  for (const [code, uni] of toUni) {
    if (uni && !fromUni.has(uni) && (codeLen === 2 || widthOf(code) > 0 || uni === " ")) fromUni.set(uni, code);
  }
  const isSubset = /^[A-Z]{6}\+/.test(baseFont);
  return {
    baseFont,
    codeLen,
    toUni,
    fromUni,
    widthOf,
    subsetUnreliable: (isSubset && !hasToUnicode) || (subtype === "Type0" && !hasToUnicode) || (embedded && !isSubset && !hasToUnicode && subtype === "Type3"),
    seen: new Set(),
    ...classify(baseFont, flags),
  };
}

// --- Interprétation --------------------------------------------------------------------

type M = [number, number, number, number, number, number];
const I: M = [1, 0, 0, 1, 0, 0];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

interface Gs {
  ctm: M;
  fontKey: string;
  size: number;
  tc: number;
  tw: number;
  th: number;
  tl: number;
  rise: number;
  tr: number;
  fill: Rgb;
}

interface Glyph {
  uni: string;
  x0: number;
  x1: number;
}

interface Fragment {
  instr: number;
  fontKey: string;
  gs: Gs;
  m: M;
  glyphs: Glyph[];
  /** Déplacement total (espace de texte, échelle horizontale comprise). */
  adv: number;
  /** Décalage du premier glyphe (premier nombre d'un TJ). */
  lead: number;
}

export interface TextRun {
  id: number;
  text: string;
  x: number;
  y: number;
  angle: number;
  size: number;
  width: number;
  color: Rgb;
  family: FontFamily;
  bold: boolean;
  italic: boolean;
  fontName: string;
  /** Texte déchiffrable : sinon la modification est refusée. */
  readable: boolean;
}

interface Analysis {
  content: Uint8Array;
  instrs: Instr[];
  frags: Fragment[];
  groups: number[][];
  runs: TextRun[];
  fonts: Map<string, FontInfo>;
}

export function pageContent(doc: PDFDocument, page: PDFPage): Uint8Array {
  const ctx = doc.context;
  const c = ctx.lookup(page.node.get(PDFName.of("Contents")));
  const parts: Uint8Array[] = [];
  const push = (s: unknown) => {
    const b = streamBytes(ctx.lookup(s as PDFRef));
    if (b) parts.push(b);
  };
  if (c instanceof PDFArray) c.asArray().forEach(push);
  else if (c) push(c);
  const total = parts.reduce((a, p) => a + p.length + 1, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
    out[at++] = 10;
  }
  return out;
}

const nums = (a: Operand[]) => a.filter((x): x is number => typeof x === "number");
function colorFrom(v: number[]): Rgb | null {
  if (v.length === 1) return [v[0], v[0], v[0]];
  if (v.length === 3) return [v[0], v[1], v[2]];
  if (v.length === 4) return [(1 - v[0]) * (1 - v[3]), (1 - v[1]) * (1 - v[3]), (1 - v[2]) * (1 - v[3])];
  return null;
}

function analyse(doc: PDFDocument, page: PDFPage): Analysis {
  const content = pageContent(doc, page);
  const instrs = parseContent(content);
  const resources = page.node.getInheritableAttribute(PDFName.of("Resources"));
  const res = doc.context.lookup(resources);
  const fontDict = res instanceof PDFDict ? doc.context.lookup(res.get(PDFName.of("Font"))) : null;
  const fonts = new Map<string, FontInfo>();
  const fontOf = (key: string): FontInfo | null => {
    if (fonts.has(key)) return fonts.get(key)!;
    const d = fontDict instanceof PDFDict ? doc.context.lookup(fontDict.get(PDFName.of(key))) : null;
    if (!(d instanceof PDFDict)) return null;
    let f: FontInfo;
    try {
      f = loadFont(doc, d);
    } catch {
      return null;
    }
    fonts.set(key, f);
    return f;
  };

  const frags: Fragment[] = [];
  let gs: Gs = { ctm: I, fontKey: "", size: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0, tr: 0, fill: [0, 0, 0] };
  const stack: Gs[] = [];
  let tm: M = I;
  let tlm: M = I;
  const nextLine = (tx: number, ty: number) => {
    tlm = mul([1, 0, 0, 1, tx, ty], tlm);
    tm = tlm;
  };
  const show = (idx: number, items: Operand[]) => {
    const font = fontOf(gs.fontKey);
    if (!font) return;
    const glyphs: Glyph[] = [];
    let x = 0;
    let lead = 0;
    for (const it of items) {
      if (typeof it === "number") {
        const d = (-it / 1000) * gs.size * gs.th;
        x += d;
        if (!glyphs.length) lead = x;
      } else if (it && typeof it === "object" && "str" in it) {
        const s = it.str;
        for (let k = 0; k + font.codeLen <= s.length; k += font.codeLen) {
          const code = font.codeLen === 2 ? s[k] * 256 + s[k + 1] : s[k];
          const tx = ((font.widthOf(code) / 1000) * gs.size + gs.tc + (font.codeLen === 1 && code === 32 ? gs.tw : 0)) * gs.th;
          const uni = font.toUni.get(code) ?? "�";
          font.seen.add(uni);
          glyphs.push({ uni, x0: x, x1: x + tx });
          x += tx;
        }
      }
    }
    frags.push({ instr: idx, fontKey: gs.fontKey, gs: { ...gs }, m: mul(tm, gs.ctm), glyphs, adv: x, lead });
    tm = mul([1, 0, 0, 1, x, 0], tm);
  };

  instrs.forEach((ins, idx) => {
    const a = ins.args;
    const v = nums(a);
    switch (ins.op) {
      case "q":
        stack.push({ ...gs });
        break;
      case "Q":
        gs = stack.pop() ?? gs;
        break;
      case "cm":
        if (v.length === 6) gs.ctm = mul(v as M, gs.ctm);
        break;
      case "BT":
        tm = tlm = I;
        break;
      case "Tf": {
        const n = a[0];
        if (n && typeof n === "object" && "name" in n) gs.fontKey = n.name;
        gs.size = v[0] ?? 0;
        break;
      }
      case "Tc": gs.tc = v[0] ?? 0; break;
      case "Tw": gs.tw = v[0] ?? 0; break;
      case "Tz": gs.th = (v[0] ?? 100) / 100; break;
      case "TL": gs.tl = v[0] ?? 0; break;
      case "Ts": gs.rise = v[0] ?? 0; break;
      case "Tr": gs.tr = v[0] ?? 0; break;
      case "Td": nextLine(v[0] ?? 0, v[1] ?? 0); break;
      case "TD":
        gs.tl = -(v[1] ?? 0);
        nextLine(v[0] ?? 0, v[1] ?? 0);
        break;
      case "Tm":
        if (v.length === 6) tm = tlm = v as M;
        break;
      case "T*": nextLine(0, -gs.tl); break;
      case "Tj": show(idx, a); break;
      case "TJ": show(idx, Array.isArray(a[0]) ? a[0] : []); break;
      case "'":
        nextLine(0, -gs.tl);
        show(idx, a);
        break;
      case '"':
        gs.tw = (a[0] as number) ?? 0;
        gs.tc = (a[1] as number) ?? 0;
        nextLine(0, -gs.tl);
        show(idx, a.slice(2));
        break;
      case "g": case "rg": case "k": case "sc": case "scn": {
        gs.fill = colorFrom(v) ?? gs.fill;
        break;
      }
    }
  });

  // Regroupement : même police, même corps, même couleur, à la suite sur la même ligne.
  const groups: number[][] = [];
  const geom = (f: Fragment) => {
    const { m } = f;
    const sx = Math.hypot(m[0], m[1]);
    const sy = Math.hypot(m[2], m[3]);
    const first = f.glyphs[0]?.x0 ?? f.lead;
    const start = { x: first * m[0] + f.gs.rise * m[2] + m[4], y: first * m[1] + f.gs.rise * m[3] + m[5] };
    const lastX = f.glyphs.at(-1)?.x1 ?? first;
    const end = { x: lastX * m[0] + f.gs.rise * m[2] + m[4], y: lastX * m[1] + f.gs.rise * m[3] + m[5] };
    return { sx, sy, start, end, angle: Math.atan2(m[1], m[0]), size: f.gs.size * sy, det: m[0] * m[3] - m[1] * m[2] };
  };
  const visible = (f: Fragment) => f.gs.tr < 3 && f.glyphs.length > 0 && f.gs.size !== 0;
  frags.forEach((f, i) => {
    if (!visible(f)) return;
    const g = geom(f);
    const cur = groups.at(-1);
    if (cur) {
      const pi = cur.at(-1)!;
      const p = frags[pi];
      const pg = geom(p);
      const sameStyle = p.fontKey === f.fontKey && Math.abs(pg.size - g.size) < 0.01 && p.gs.fill.every((c, k) => Math.abs(c - f.gs.fill[k]) < 0.002);
      if (sameStyle && Math.abs(pg.angle - g.angle) < 0.01) {
        const dx = g.start.x - pg.end.x;
        const dy = g.start.y - pg.end.y;
        const along = dx * Math.cos(g.angle) + dy * Math.sin(g.angle);
        const across = -dx * Math.sin(g.angle) + dy * Math.cos(g.angle);
        if (Math.abs(across) < 0.15 * g.size && along > -0.5 * g.size && along < 1.5 * g.size) {
          cur.push(i);
          return;
        }
      }
    }
    groups.push([i]);
  });

  const runs: TextRun[] = [];
  groups.forEach((grp, id) => {
    const first = frags[grp[0]];
    const font = fonts.get(first.fontKey);
    if (!font) return;
    const g0 = geom(first);
    let text = "";
    let lastEndAlong: number | null = null;
    const cos = Math.cos(g0.angle);
    const sin = Math.sin(g0.angle);
    let endAlong = 0;
    for (const fi of grp) {
      const f = frags[fi];
      const sx = Math.hypot(f.m[0], f.m[1]);
      for (const gl of f.glyphs) {
        const px = gl.x0 * f.m[0] + f.gs.rise * f.m[2] + f.m[4];
        const py = gl.x0 * f.m[1] + f.gs.rise * f.m[3] + f.m[5];
        const along = (px - g0.start.x) * cos + (py - g0.start.y) * sin;
        if (lastEndAlong !== null && along - lastEndAlong > 0.2 * g0.size && !text.endsWith(" ")) text += " ";
        text += gl.uni;
        lastEndAlong = along + (gl.x1 - gl.x0) * sx;
        endAlong = Math.max(endAlong, lastEndAlong);
      }
    }
    if (!text.trim()) return;
    runs.push({
      id,
      text: text.replace(/ /g, " ").replace(/\s+$/, ""),
      x: g0.start.x,
      y: g0.start.y,
      angle: (g0.angle * 180) / Math.PI,
      size: g0.size,
      width: endAlong,
      color: first.gs.fill.map((c) => Math.min(1, Math.max(0, c))) as Rgb,
      family: font.family,
      bold: font.bold,
      italic: font.italic,
      fontName: font.baseFont.replace(/^[A-Z]{6}\+/, ""),
      readable: !text.includes("�") && g0.det > 0,
    });
  });
  return { content, instrs, frags, groups, runs, fonts };
}

export async function listRuns(bytes: Bytes, pageIndex: number): Promise<TextRun[]> {
  const doc = await openDoc(bytes);
  return analyse(doc, doc.getPage(pageIndex)).runs;
}

// --- Réécriture ----------------------------------------------------------------------------

const hexOf = (code: number, len: number) => code.toString(16).toUpperCase().padStart(len * 2, "0");
const fmt = (n: number) => {
  const s = n.toFixed(3).replace(/\.?0+$/, "");
  return s === "-0" || s === "" ? "0" : s;
};

/** Texte encodé pour la police d'origine, ou null s'il lui manque un caractère. */
function encodeForFont(font: FontInfo, text: string, gs: Gs): { tj: string; adv: number } | null {
  const parts: string[] = [];
  let hex = "";
  let adv = 0;
  const flush = () => {
    if (hex) parts.push(`<${hex}>`);
    hex = "";
  };
  const allowed = (s: string) => !font.subsetUnreliable || font.seen.has(s);
  const chars = [...text.normalize("NFC")];
  const ligatures = ["ffi", "ffl", "ff", "fi", "fl"];
  for (let i = 0; i < chars.length; i++) {
    let ch = chars[i];
    let code = allowed(ch) ? font.fromUni.get(ch) : undefined;
    if (code === undefined) {
      // Polices dont les « fi », « fl » n'existent qu'en ligature.
      const rest = chars.slice(i, i + 3).join("");
      const lig = ligatures.find((l) => rest.startsWith(l) && allowed(l) && font.fromUni.has(l));
      if (lig) {
        code = font.fromUni.get(lig);
        ch = lig;
        i += lig.length - 1;
      }
    }
    if (code === undefined) {
      if (ch !== " " && ch !== " ") return null;
      // Pas de glyphe d'espace (fréquent dans les polices réduites) : un décalage.
      flush();
      parts.push(fmt(-250));
      adv += (250 / 1000) * gs.size * gs.th;
      continue;
    }
    hex += hexOf(code, font.codeLen);
    adv += ((font.widthOf(code) / 1000) * gs.size + gs.tc + (font.codeLen === 1 && code === 32 ? gs.tw : 0)) * gs.th;
  }
  flush();
  return { tj: `[${parts.join(" ")}] TJ`, adv };
}

export interface RunEdit {
  text: string;
  /** Style imposé : la police standard la plus proche est alors utilisée. */
  size?: number;
  color?: Rgb;
  family?: FontFamily;
  bold?: boolean;
  italic?: boolean;
}

function advanceOnly(gs: Gs, adv: number): string {
  if (!adv || !gs.size || !gs.th) return "";
  return `[${fmt((-adv * 1000) / (gs.size * gs.th))}] TJ`;
}

/** Préfixe des opérateurs ' et " : ce qu'ils font en plus d'afficher. */
function prefixOf(ins: Instr): string {
  if (ins.op === "'") return "T* ";
  if (ins.op === '"') return `${fmt(ins.args[0] as number)} Tw ${fmt(ins.args[1] as number)} Tc T* `;
  return "";
}

const encodeLatin = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

export interface EditResult {
  bytes: Bytes;
  /** La police d'origine a pu être gardée. */
  sameFont: boolean;
  fontName: string;
}

export async function editRun(bytes: Bytes, pageIndex: number, runId: number, edit: RunEdit): Promise<EditResult> {
  const doc = await openDoc(bytes);
  const page = doc.getPage(pageIndex);
  const a = analyse(doc, page);
  const run = a.runs.find((r) => r.id === runId);
  const grp = a.groups[runId];
  if (!run || !grp) throw new CoreError("text", "Ce texte n'existe plus sur la page.");
  if (!run.readable) throw new CoreError("text", "Le texte de cette police ne peut pas être déchiffré ; il ne peut pas être modifié ici.");

  const text = edit.text.replace(/\r?\n/g, " ");
  const styled = edit.size !== undefined || edit.color !== undefined || edit.family !== undefined || edit.bold !== undefined || edit.italic !== undefined;
  const first = a.frags[grp[0]];
  const font = a.fonts.get(first.fontKey)!;
  const reuse = !styled && text ? encodeForFont(font, text, first.gs) : null;
  if (text && !reuse) {
    const bad = unsupportedChar(text);
    if (bad) throw new CoreError("charset", `Le caractère « ${bad} » n'existe ni dans la police du document ni dans les polices standard.`);
  }

  // Remplacement des instructions, de la fin vers le début.
  const repl = grp.map((fi, k) => {
    const f = a.frags[fi];
    const ins = a.instrs[f.instr];
    let code = prefixOf(ins);
    if (k === 0 && reuse) {
      const lead = f.lead ? `[${fmt((-f.lead * 1000) / (f.gs.size * f.gs.th))}] TJ ` : "";
      code += lead + reuse.tj;
      const rest = advanceOnly(f.gs, f.adv - f.lead - reuse.adv);
      if (rest) code += ` ${rest}`;
    } else {
      code += advanceOnly(f.gs, f.adv);
    }
    return { start: ins.start, end: ins.end, code: encodeLatin(code) };
  });
  const chunks: Uint8Array[] = [];
  let at = 0;
  for (const r of repl) {
    chunks.push(a.content.subarray(at, r.start), r.code);
    at = r.end;
  }
  chunks.push(a.content.subarray(at));
  const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
  let w = 0;
  for (const c of chunks) {
    out.set(c, w);
    w += c.length;
  }
  const ctx = doc.context;
  page.node.set(PDFName.of("Contents"), ctx.register(ctx.flateStream(out)));

  let fontName = run.fontName;
  if (text && !reuse) {
    const name = standardFontName(edit.family ?? run.family, edit.bold ?? run.bold, edit.italic ?? run.italic);
    const std = await doc.embedFont(name);
    fontName = name;
    page.drawText(fitWinAnsi(text), {
      x: run.x,
      y: run.y,
      size: edit.size ?? run.size,
      font: std,
      color: rgb(...(edit.color ?? run.color)),
      rotate: degrees(run.angle),
    });
  }
  return { bytes: await saveDoc(doc), sameFont: !!reuse, fontName };
}
