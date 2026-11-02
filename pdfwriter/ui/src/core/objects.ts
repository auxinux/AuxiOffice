// Objets ajoutés sur les pages (texte, images, formes). Ils restent modifiables
// pendant la session et sont écrits dans le PDF à l'enregistrement. Position :
// coin supérieur gauche de l'objet en coordonnées du PDF, `angle` = sens de
// lecture (degrés, sens direct) ; ainsi un objet suit sa page quand elle tourne.

import { Encodings, Font, type IFontNames } from "@pdf-lib/standard-fonts";
import { BlendMode, degrees, LineCapStyle, type PDFDocument, type PDFFont, type PDFImage, rgb, StandardFonts } from "pdf-lib";
import { type Bytes, CoreError, fitWinAnsi, openDoc, type Rgb, saveDoc } from "./pages";

export type FontFamily = "Helvetica" | "Times" | "Courier";
export type Align = "left" | "center" | "right";

interface Base {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
}
export interface TextObj extends Base {
  kind: "text";
  text: string;
  family: FontFamily;
  bold: boolean;
  italic: boolean;
  size: number;
  color: Rgb;
  align: Align;
}
export interface ImageObj extends Base {
  kind: "image";
  bytes: Bytes;
  mime: "image/png" | "image/jpeg";
  /** Adresse d'affichage (interface seulement). */
  url?: string;
}
export interface ShapeObj extends Base {
  kind: "rect" | "ellipse" | "line";
  stroke: Rgb | null;
  fill: Rgb | null;
  strokeWidth: number;
  opacity: number;
}
export interface MarkObj extends Base {
  kind: "highlight" | "whiteout";
  color: Rgb;
}
export type PageObject = TextObj | ImageObj | ShapeObj | MarkObj;

export const LINE_HEIGHT = 1.2;
/** Position de la ligne de base dans une ligne de hauteur 1,2 × corps, pour que
 * l'aperçu (polices métriquement compatibles) coïncide avec le PDF. */
const BASELINE: Record<FontFamily, number> = { Helvetica: 0.9465, Times: 0.9375, Courier: 0.8665 };

export function standardFontName(family: FontFamily, bold: boolean, italic: boolean): StandardFonts {
  const table: Record<FontFamily, [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
    Helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
    Times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
    Courier: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
  };
  return table[family][(bold ? 1 : 0) + (italic ? 2 : 0)];
}

const metrics = new Map<string, Font>();

/** Largeur d'un texte en police standard (sans crénage, comme le dessin). */
export function textWidth(s: string, family: FontFamily, bold: boolean, italic: boolean, size: number): number {
  const name = standardFontName(family, bold, italic) as unknown as IFontNames;
  let f = metrics.get(name);
  if (!f) {
    f = Font.load(name);
    metrics.set(name, f);
  }
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    const glyph = Encodings.WinAnsi.canEncodeUnicodeCodePoint(cp) ? Encodings.WinAnsi.encodeUnicodeCodePoint(cp).name : "space";
    w += Number(f.getWidthOfGlyph(glyph) ?? 500);
  }
  return (w / 1000) * size;
}


/** Découpe en lignes, à la largeur de la boîte : l'aperçu et le PDF utilisent ce même résultat. */
export function wrapLines(o: Pick<TextObj, "text" | "family" | "bold" | "italic" | "size" | "w">): string[] {
  const out: string[] = [];
  const measure = (s: string) => textWidth(s, o.family, o.bold, o.italic, o.size);
  for (const para of o.text.split("\n")) {
    let line = "";
    for (const piece of para.split(/(?<=[ \t])/)) {
      const next = line + piece;
      if (measure(next.trimEnd()) <= o.w || !line) {
        line = next;
      } else {
        out.push(line.trimEnd());
        line = piece;
      }
      // Mot plus long que la boîte : coupé.
      while (measure(line.trimEnd()) > o.w && line.length > 1) {
        let k = line.length - 1;
        while (k > 1 && measure(line.slice(0, k)) > o.w) k--;
        out.push(line.slice(0, k));
        line = line.slice(k);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** Premier caractère que les polices standard ne savent pas écrire. */
export function unsupportedChar(text: string): string | null {
  for (const ch of fitWinAnsi(text)) {
    if (ch === "\n" || ch === "\t") continue;
    if (!Encodings.WinAnsi.canEncodeUnicodeCodePoint(ch.codePointAt(0)!)) return ch;
  }
  return null;
}

export async function flatten(bytes: Bytes, perPage: [number, PageObject[]][]): Promise<Bytes> {
  if (perPage.every(([, l]) => !l.length)) return bytes;
  const doc = await openDoc(bytes);
  await drawObjects(doc, perPage);
  return saveDoc(doc);
}

export async function drawObjects(doc: PDFDocument, perPage: [number, PageObject[]][]) {
  const fonts = new Map<string, PDFFont>();
  const images = new Map<Bytes, PDFImage>();
  const font = async (name: StandardFonts) => {
    let f = fonts.get(name);
    if (!f) {
      f = await doc.embedFont(name);
      fonts.set(name, f);
    }
    return f;
  };
  for (const [index, list] of perPage) {
    const page = doc.getPage(index);
    for (const o of list) {
      const rad = (o.angle * Math.PI) / 180;
      const [cos, sin] = [Math.cos(rad), Math.sin(rad)];
      // Repère local de l'objet : u vers la droite, v vers le bas.
      const at = (u: number, v: number) => ({ x: o.x + u * cos + v * sin, y: o.y + u * sin - v * cos });
      const rotate = degrees(o.angle);
      switch (o.kind) {
        case "text": {
          const bad = unsupportedChar(o.text);
          if (bad) throw new CoreError("charset", `Le caractère « ${bad} » n'existe pas dans les polices standard.`);
          const f = await font(standardFontName(o.family, o.bold, o.italic));
          const lh = o.size * LINE_HEIGHT;
          const color = rgb(...o.color);
          wrapLines({ ...o, text: fitWinAnsi(o.text) }).forEach((line, i) => {
            if (!line) return;
            const w = textWidth(line, o.family, o.bold, o.italic, o.size);
            const u = o.align === "center" ? (o.w - w) / 2 : o.align === "right" ? o.w - w : 0;
            const p = at(u, i * lh + BASELINE[o.family] * o.size);
            page.drawText(line, { x: p.x, y: p.y, size: o.size, font: f, color, rotate });
          });
          break;
        }
        case "image": {
          let img = images.get(o.bytes);
          if (!img) {
            img = o.mime === "image/png" ? await doc.embedPng(o.bytes) : await doc.embedJpg(o.bytes);
            images.set(o.bytes, img);
          }
          const p = at(0, o.h);
          page.drawImage(img, { x: p.x, y: p.y, width: o.w, height: o.h, rotate });
          break;
        }
        case "rect": {
          const p = at(0, o.h);
          page.drawRectangle({
            x: p.x, y: p.y, width: o.w, height: o.h, rotate,
            color: o.fill ? rgb(...o.fill) : undefined,
            borderColor: o.stroke ? rgb(...o.stroke) : undefined,
            borderWidth: o.stroke ? o.strokeWidth : 0,
            opacity: o.opacity, borderOpacity: o.opacity,
          });
          break;
        }
        case "ellipse": {
          const p = at(o.w / 2, o.h / 2);
          page.drawEllipse({
            x: p.x, y: p.y, xScale: o.w / 2, yScale: o.h / 2, rotate,
            color: o.fill ? rgb(...o.fill) : undefined,
            borderColor: o.stroke ? rgb(...o.stroke) : undefined,
            borderWidth: o.stroke ? o.strokeWidth : 0,
            opacity: o.opacity, borderOpacity: o.opacity,
          });
          break;
        }
        case "line":
          // w et h peuvent être négatifs : la ligne va de (0,0) à (w,h).
          page.drawLine({ start: at(0, 0), end: at(o.w, o.h), thickness: o.strokeWidth, color: rgb(...(o.stroke ?? [0, 0, 0])), opacity: o.opacity, lineCap: LineCapStyle.Round });
          break;
        case "highlight": {
          const p = at(0, o.h);
          page.drawRectangle({ x: p.x, y: p.y, width: o.w, height: o.h, rotate, color: rgb(...o.color), blendMode: BlendMode.Multiply, borderWidth: 0 });
          break;
        }
        case "whiteout": {
          const p = at(0, o.h);
          page.drawRectangle({ x: p.x, y: p.y, width: o.w, height: o.h, rotate, color: rgb(...o.color), borderWidth: 0 });
          break;
        }
      }
    }
  }
}
