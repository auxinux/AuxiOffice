// Opérations sur la structure d'un PDF : création, pages, fusion, découpe,
// images, numérotation, filigrane, recadrage, métadonnées. Toutes prennent des
// octets et rendent des octets (voir worker.ts) ; aucune dépendance au DOM.

import { degrees, PageSizes, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, type PDFPage, PDFRef, PDFStream, rgb, StandardFonts } from "pdf-lib";

export type Bytes = Uint8Array;

export class CoreError extends Error {
  constructor(public code: "encrypted" | "invalid" | "range" | "charset" | "text", message: string) {
    super(message);
  }
}

const SAVE = { useObjectStreams: true, updateFieldAppearances: false, addDefaultPage: false } as const;

export async function openDoc(bytes: Bytes): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    if ((e as Error)?.constructor?.name === "EncryptedPDFError" || /encrypted/i.test(String((e as Error)?.message))) {
      throw new CoreError("encrypted", "Ce PDF est chiffré.");
    }
    throw new CoreError("invalid", `Ce PDF ne peut pas être modifié : ${(e as Error)?.message ?? e}`);
  }
}

/** Retire les objets que plus rien ne référence. pdf-lib les écrirait sinon
 * dans le fichier : le contenu d'une page supprimée ou le texte remplacé y
 * resteraient lisibles. Une référence à une page qui n'est plus dans le
 * document (signet, lien) n'en garde pas le contenu. */
export function collectGarbage(doc: PDFDocument) {
  const ctx = doc.context;
  const livePages = new Set(doc.getPages().map((p) => p.ref.tag));
  const seen = new Set<string>();
  const stack: unknown[] = Object.values(ctx.trailerInfo);
  while (stack.length) {
    const o = stack.pop();
    if (o instanceof PDFRef) {
      if (seen.has(o.tag)) continue;
      const target = ctx.lookup(o);
      if (target instanceof PDFDict && target.get(PDFName.of("Type")) === PDFName.of("Page") && !livePages.has(o.tag)) continue;
      seen.add(o.tag);
      stack.push(target);
    } else if (o instanceof PDFDict) {
      stack.push(...o.values());
    } else if (o instanceof PDFArray) {
      stack.push(...o.asArray());
    } else if (o instanceof PDFStream) {
      stack.push(o.dict);
    }
  }
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!seen.has(ref.tag)) ctx.delete(ref);
  }
}

export async function saveDoc(doc: PDFDocument): Promise<Bytes> {
  await doc.flush();
  collectGarbage(doc);
  return doc.save(SAVE);
}

async function fresh(): Promise<PDFDocument> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setProducer("AuxiPDFWriter");
  doc.setCreator("AuxiPDFWriter");
  const now = new Date();
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  return doc;
}

// --- Formats et plages de pages ---------------------------------------------

export const PAGE_FORMATS: Record<string, { label: string; size: [number, number] }> = {
  letter: { label: "Lettre (216 × 279 mm)", size: PageSizes.Letter },
  legal: { label: "Légal (216 × 356 mm)", size: PageSizes.Legal },
  tabloid: { label: "Tabloïd (279 × 432 mm)", size: PageSizes.Tabloid },
  a3: { label: "A3 (297 × 420 mm)", size: PageSizes.A3 },
  a4: { label: "A4 (210 × 297 mm)", size: PageSizes.A4 },
  a5: { label: "A5 (148 × 210 mm)", size: PageSizes.A5 },
};

export interface PageSpec {
  format: string;
  landscape: boolean;
}

function specSize(s: PageSpec): [number, number] {
  const [w, h] = (PAGE_FORMATS[s.format] ?? PAGE_FORMATS.letter).size;
  return s.landscape ? [h, w] : [w, h];
}

/** « 1-3, 5, 8- » → indices à partir de 0, dans l'ordre donné ; « 5-3 » descend. */
export function parseRanges(text: string, pageCount: number): number[] {
  const out: number[] = [];
  const clean = text.trim();
  if (!clean) throw new CoreError("range", "Indiquez au moins une page.");
  for (const part of clean.split(/[,;]/)) {
    const p = part.trim();
    const m = /^(\d+)?\s*(-)?\s*(\d+)?$/.exec(p);
    if (!p || !m || (!m[1] && !m[3])) throw new CoreError("range", `Plage invalide : « ${p} » (exemple : 1-3, 5, 8-).`);
    const a = m[1] ? Number(m[1]) : 1;
    const b = m[2] ? (m[3] ? Number(m[3]) : pageCount) : a;
    if (a < 1 || b < 1 || a > pageCount || b > pageCount) throw new CoreError("range", `La page ${Math.max(a, b) > pageCount ? Math.max(a, b) : 0} n'existe pas (le document en a ${pageCount}).`);
    const step = a <= b ? 1 : -1;
    for (let i = a; step > 0 ? i <= b : i >= b; i += step) out.push(i - 1);
  }
  return out;
}

// --- Repère « tel qu'affiché » d'une page -------------------------------------

/** Passage des coordonnées affichées (origine en haut à gauche, rotation de la
 * page appliquée) aux coordonnées du PDF. */
export interface Frame {
  w: number;
  h: number;
  angle: number;
  point(u: number, v: number): { x: number; y: number };
}

export function pageFrame(page: PDFPage): Frame {
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  const { x: x0, y: y0, width: W, height: H } = page.getCropBox();
  switch (r) {
    case 90:
      return { w: H, h: W, angle: 90, point: (u, v) => ({ x: x0 + v, y: y0 + u }) };
    case 180:
      return { w: W, h: H, angle: 180, point: (u, v) => ({ x: x0 + W - u, y: y0 + v }) };
    case 270:
      return { w: H, h: W, angle: 270, point: (u, v) => ({ x: x0 + W - v, y: y0 + H - u }) };
    default:
      return { w: W, h: H, angle: 0, point: (u, v) => ({ x: x0 + u, y: y0 + H - v }) };
  }
}

// --- Création -------------------------------------------------------------------

export async function createBlank(spec: PageSpec, count = 1): Promise<Bytes> {
  const doc = await fresh();
  for (let i = 0; i < Math.max(1, count); i++) doc.addPage(specSize(spec));
  return saveDoc(doc);
}

export interface ImageSource {
  bytes: Bytes;
  mime: "image/png" | "image/jpeg";
}

/** Un PDF à partir d'images, une par page (`fit` : la page prend la taille de l'image). */
export async function imagesToPdf(images: ImageSource[], format: string | "fit", margin = 0): Promise<Bytes> {
  const doc = await fresh();
  for (const im of images) {
    const img = im.mime === "image/png" ? await doc.embedPng(im.bytes) : await doc.embedJpg(im.bytes);
    if (format === "fit") {
      const page = doc.addPage([img.width + 2 * margin, img.height + 2 * margin]);
      page.drawImage(img, { x: margin, y: margin, width: img.width, height: img.height });
      continue;
    }
    const [a, b] = (PAGE_FORMATS[format] ?? PAGE_FORMATS.letter).size;
    const size: [number, number] = img.width > img.height ? [b, a] : [a, b];
    const page = doc.addPage(size);
    const k = Math.min((size[0] - 2 * margin) / img.width, (size[1] - 2 * margin) / img.height);
    const [w, h] = [img.width * k, img.height * k];
    page.drawImage(img, { x: (size[0] - w) / 2, y: (size[1] - h) / 2, width: w, height: h });
  }
  return saveDoc(doc);
}

// --- Pages -------------------------------------------------------------------------

/** Les attributs hérités des nœuds de l'arbre des pages sont recopiés sur la
 * page : retirer une page peut supprimer son nœud parent. */
function materialize(page: PDFPage) {
  for (const key of ["Resources", "MediaBox", "CropBox", "Rotate"]) {
    const name = PDFName.of(key);
    const v = page.node.getInheritableAttribute(name);
    if (v) page.node.set(name, v);
  }
}

/** Nouvel ordre des pages : indices d'origine ; absent = supprimée ; répété = dupliquée. */
export async function rearrange(bytes: Bytes, order: number[]): Promise<Bytes> {
  if (!order.length) throw new CoreError("range", "Un PDF doit garder au moins une page.");
  const doc = await openDoc(bytes);
  const pages = doc.getPages();
  if (order.some((i) => !Number.isInteger(i) || i < 0 || i >= pages.length)) throw new CoreError("range", "Page inexistante.");
  pages.forEach(materialize);
  const seen = new Set<number>();
  const final: PDFPage[] = [];
  for (const i of order) {
    if (seen.has(i)) {
      const [copy] = await doc.copyPages(doc, [i]);
      final.push(copy);
    } else {
      seen.add(i);
      final.push(pages[i]);
    }
  }
  for (let i = pages.length - 1; i >= 0; i--) doc.removePage(i);
  final.forEach((p, i) => doc.insertPage(i, p));
  return saveDoc(doc);
}

export async function insertBlank(bytes: Bytes, at: number, spec: PageSpec | "same", count = 1): Promise<Bytes> {
  const doc = await openDoc(bytes);
  let size: [number, number];
  if (spec === "same") {
    const f = pageFrame(doc.getPage(Math.min(Math.max(0, at - 1), doc.getPageCount() - 1)));
    size = [f.w, f.h];
  } else size = specSize(spec);
  for (let i = 0; i < count; i++) doc.insertPage(at + i, size);
  return saveDoc(doc);
}

/** Tourne des pages (multiple de 90, sens horaire), la rotation s'ajoute à l'existante. */
export async function rotatePages(bytes: Bytes, indices: number[], delta: number): Promise<Bytes> {
  const doc = await openDoc(bytes);
  for (const i of indices) {
    const p = doc.getPage(i);
    p.setRotation(degrees((((p.getRotation().angle + delta) % 360) + 360) % 360));
  }
  return saveDoc(doc);
}

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Recadre : marges retirées en points, telles qu'on voit la page. */
export async function cropPages(bytes: Bytes, indices: number[], m: Margins): Promise<Bytes> {
  const doc = await openDoc(bytes);
  for (const i of indices) {
    const p = doc.getPage(i);
    const f = pageFrame(p);
    if (m.left + m.right >= f.w - 1 || m.top + m.bottom >= f.h - 1) throw new CoreError("range", `Les marges dépassent la taille de la page ${i + 1}.`);
    const a = f.point(m.left, m.top);
    const b = f.point(f.w - m.right, f.h - m.bottom);
    p.setCropBox(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }
  return saveDoc(doc);
}

// --- Fusion et découpe ---------------------------------------------------------------

export interface MergeSource {
  bytes: Bytes;
  name: string;
  /** Indices à garder (toutes les pages si absent). */
  pages?: number[];
}

/** Table des signets : une entrée par titre, vers une page. */
function setOutline(doc: PDFDocument, items: { title: string; page: PDFRef }[]) {
  if (!items.length) return;
  const ctx = doc.context;
  const root = ctx.nextRef();
  const refs = items.map(() => ctx.nextRef());
  items.forEach((it, i) => {
    const entry: Record<string, unknown> = {
      Title: PDFHexString.fromText(it.title),
      Parent: root,
      Dest: [it.page, "XYZ", null, null, null],
    };
    if (i > 0) entry.Prev = refs[i - 1];
    if (i < items.length - 1) entry.Next = refs[i + 1];
    ctx.assign(refs[i], ctx.obj(entry as never));
  });
  ctx.assign(root, ctx.obj({ Type: "Outlines", First: refs[0], Last: refs[refs.length - 1], Count: refs.length } as never));
  doc.catalog.set(PDFName.of("Outlines"), root);
}

export async function merge(sources: MergeSource[], opts: { bookmarks?: boolean; title?: string } = {}): Promise<Bytes> {
  if (!sources.length) throw new CoreError("range", "Aucun fichier à fusionner.");
  const out = await fresh();
  const outline: { title: string; page: PDFRef }[] = [];
  for (const s of sources) {
    let src: PDFDocument;
    try {
      src = await openDoc(s.bytes);
    } catch (e) {
      throw new CoreError((e as CoreError).code ?? "invalid", `${s.name} : ${(e as Error).message}`);
    }
    const idx = s.pages ?? src.getPageIndices();
    const copied = await out.copyPages(src, idx);
    copied.forEach((p, i) => {
      out.addPage(p);
      if (i === 0) outline.push({ title: s.name.replace(/\.pdf$/i, ""), page: p.ref });
    });
  }
  if (out.getPageCount() === 0) throw new CoreError("range", "Aucune page à fusionner.");
  if (opts.bookmarks) setOutline(out, outline);
  if (opts.title) out.setTitle(opts.title);
  return saveDoc(out);
}

/** Insère des pages d'un autre PDF à la position `at`. */
export async function insertFrom(bytes: Bytes, at: number, source: Bytes, pages?: number[]): Promise<{ bytes: Bytes; count: number }> {
  const doc = await openDoc(bytes);
  const src = await openDoc(source);
  const copied = await doc.copyPages(src, pages ?? src.getPageIndices());
  copied.forEach((p, i) => doc.insertPage(at + i, p));
  return { bytes: await saveDoc(doc), count: copied.length };
}

/** Un nouveau PDF par groupe de pages. */
export async function split(bytes: Bytes, groups: number[][]): Promise<Bytes[]> {
  const src = await openDoc(bytes);
  const out: Bytes[] = [];
  for (const g of groups) {
    const doc = await fresh();
    const copied = await doc.copyPages(src, g);
    copied.forEach((p) => doc.addPage(p));
    const t = src.getTitle();
    if (t) doc.setTitle(t);
    out.push(await saveDoc(doc));
  }
  return out;
}

/** Groupes d'une découpe : toutes les `n` pages. */
export function everyN(pageCount: number, n: number): number[][] {
  if (!Number.isInteger(n) || n < 1) throw new CoreError("range", "Nombre de pages par fichier invalide.");
  const out: number[][] = [];
  for (let i = 0; i < pageCount; i += n) out.push(Array.from({ length: Math.min(n, pageCount - i) }, (_, k) => i + k));
  return out;
}

// --- Numérotation et filigrane ---------------------------------------------------------

export type Rgb = [number, number, number];

export interface NumberingOptions {
  /** Modèle : {n} = numéro, {t} = nombre total. */
  template: string;
  position: "bottom-center" | "bottom-left" | "bottom-right" | "top-center" | "top-left" | "top-right";
  size: number;
  margin: number;
  start: number;
  color: Rgb;
}

const WINANSI_FIX: [RegExp, string][] = [
  [/[   ]/g, " "],
  [/[‐‑]/g, "-"],
];

export function fitWinAnsi(s: string): string {
  for (const [re, to] of WINANSI_FIX) s = s.replace(re, to);
  return s;
}

export async function addPageNumbers(bytes: Bytes, indices: number[], o: NumberingOptions): Promise<Bytes> {
  const doc = await openDoc(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const total = indices.length + o.start - 1;
  try {
    indices.forEach((pi, k) => {
      const page = doc.getPage(pi);
      const f = pageFrame(page);
      const text = fitWinAnsi(o.template.replaceAll("{n}", String(o.start + k)).replaceAll("{t}", String(total)));
      const w = font.widthOfTextAtSize(text, o.size);
      const u = o.position.endsWith("left") ? o.margin : o.position.endsWith("right") ? f.w - o.margin - w : (f.w - w) / 2;
      const v = o.position.startsWith("top") ? o.margin + o.size : f.h - o.margin;
      const p = f.point(u, v);
      page.drawText(text, { x: p.x, y: p.y, size: o.size, font, color: rgb(...o.color), rotate: degrees(f.angle) });
    });
  } catch (e) {
    throw new CoreError("charset", `Caractère non pris en charge : ${(e as Error).message}`);
  }
  return saveDoc(doc);
}

export interface WatermarkOptions {
  text: string;
  size: number;
  opacity: number;
  color: Rgb;
  diagonal: boolean;
}

export async function addWatermark(bytes: Bytes, indices: number[], o: WatermarkOptions): Promise<Bytes> {
  const doc = await openDoc(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = fitWinAnsi(o.text);
  try {
    const w = font.widthOfTextAtSize(text, o.size);
    const capH = font.heightAtSize(o.size, { descender: false });
    for (const i of indices) {
      const page = doc.getPage(i);
      const f = pageFrame(page);
      // Angle à l'écran (sens direct), centré sur la page affichée.
      const a = o.diagonal ? (Math.atan2(f.h, f.w) * 180) / Math.PI : 0;
      const angle = f.angle + a;
      const rad = (angle * Math.PI) / 180;
      const c = f.point(f.w / 2, f.h / 2);
      const x = c.x - (w / 2) * Math.cos(rad) + (capH / 2) * Math.sin(rad);
      const y = c.y - (w / 2) * Math.sin(rad) - (capH / 2) * Math.cos(rad);
      page.drawText(text, { x, y, size: o.size, font, color: rgb(...o.color), opacity: o.opacity, rotate: degrees(angle) });
    }
  } catch (e) {
    throw new CoreError("charset", `Caractère non pris en charge : ${(e as Error).message}`);
  }
  return saveDoc(doc);
}

// --- Métadonnées --------------------------------------------------------------------------

export interface Metadata {
  title: string;
  author: string;
  subject: string;
  keywords: string;
}

export async function getMetadata(bytes: Bytes): Promise<Metadata> {
  const doc = await openDoc(bytes);
  return { title: doc.getTitle() ?? "", author: doc.getAuthor() ?? "", subject: doc.getSubject() ?? "", keywords: doc.getKeywords() ?? "" };
}

export async function setMetadata(bytes: Bytes, m: Metadata): Promise<Bytes> {
  const doc = await openDoc(bytes);
  doc.setTitle(m.title);
  doc.setAuthor(m.author);
  doc.setSubject(m.subject);
  doc.setKeywords(m.keywords.split(/[,;]/).map((k) => k.trim()).filter(Boolean));
  doc.setModificationDate(new Date());
  return saveDoc(doc);
}

