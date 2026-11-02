// Les PDF produits sont relus par PDF.js, un lecteur indépendant de pdf-lib.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDict, PDFDocument, PDFName, rgb, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { type PageObject, flatten, unsupportedChar, wrapLines } from "./objects";
import * as P from "./pages";
import { editRun, listRuns, parseContent } from "./textedit";

async function load(bytes: Uint8Array) {
  return getDocument({ data: bytes.slice(), verbosity: 0, useSystemFonts: false }).promise;
}
async function textOf(bytes: Uint8Array, page = 1) {
  const d = await load(bytes);
  const c = await (await d.getPage(page)).getTextContent();
  const s = c.items.map((i) => ("str" in i ? i.str : "")).join(" ").replace(/\s+/g, " ").trim();
  await d.loadingTask.destroy();
  return s;
}
async function info(bytes: Uint8Array) {
  const d = await load(bytes);
  const out = [];
  for (let i = 1; i <= d.numPages; i++) {
    const p = await d.getPage(i);
    const v = p.getViewport({ scale: 1 });
    out.push({ w: Math.round(v.width), h: Math.round(v.height), r: p.rotate });
  }
  await d.loadingTask.destroy();
  return out;
}
/** Document de n pages, « Page i » sur chacune. */
async function sample(n: number, size: [number, number] = [612, 792]) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= n; i++) d.addPage(size).drawText(`Page ${i}`, { x: 10, y: size[1] - 40, size: 20, font: f });
  return d.save();
}
const pageTexts = async (b: Uint8Array) => {
  const n = (await info(b)).length;
  const out = [];
  for (let i = 1; i <= n; i++) out.push(await textOf(b, i));
  return out;
};

/** PDF écrit à la main : arbre de pages à plusieurs niveaux, attributs hérités,
 * flux non compressé, opérateurs variés. */
function rawPdf(content: string, fontExtra = "/Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding", page2 = "BT /F1 12 Tf 10 10 Td (Deux) Tj ET") {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 2 /MediaBox [0 0 400 500] /Resources << /Font << /F1 6 0 R >> >> >>",
    "<< /Type /Pages /Parent 2 0 R /Kids [4 0 R 5 0 R] /Count 2 /Rotate 90 >>",
    "<< /Type /Page /Parent 3 0 R /Contents 7 0 R >>",
    "<< /Type /Page /Parent 3 0 R /Contents 8 0 R >>",
    `<< /Type /Font ${fontExtra} >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Length ${page2.length} >>\nstream\n${page2}\nendstream`,
  ];
  let out = "%PDF-1.5\n";
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0));
}

describe("plages de pages", () => {
  it("lit les plages usuelles", () => {
    expect(P.parseRanges("1-3, 5", 9)).toEqual([0, 1, 2, 4]);
    expect(P.parseRanges("8-", 9)).toEqual([7, 8]);
    expect(P.parseRanges("-2", 9)).toEqual([0, 1]);
    expect(P.parseRanges("3-1", 9)).toEqual([2, 1, 0]);
  });
  it("refuse le reste", () => {
    for (const bad of ["", "a", "0", "10", "1-10", "1,,2", "-"]) expect(() => P.parseRanges(bad, 9), bad).toThrow();
  });
  it("découpe toutes les n pages", () => {
    expect(P.everyN(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
    expect(() => P.everyN(5, 0)).toThrow();
  });
});

describe("création", () => {
  it("document vierge au format demandé", async () => {
    const b = await P.createBlank({ format: "a4", landscape: true }, 2);
    expect(await info(b)).toEqual([{ w: 842, h: 595, r: 0 }, { w: 842, h: 595, r: 0 }]);
  });
});

describe("pages", () => {
  it("réordonne, supprime et duplique", async () => {
    const s = await sample(4);
    expect(await pageTexts(await P.rearrange(s, [3, 0, 1, 2]))).toEqual(["Page 4", "Page 1", "Page 2", "Page 3"]);
    expect(await pageTexts(await P.rearrange(s, [1, 3]))).toEqual(["Page 2", "Page 4"]);
    expect(await pageTexts(await P.rearrange(s, [0, 0, 1, 2, 3]))).toEqual(["Page 1", "Page 1", "Page 2", "Page 3", "Page 4"]);
  });
  it("le contenu d'une page supprimée quitte vraiment le fichier", async () => {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    d.addPage().drawText("A", { font: f });
    const secret = d.addPage();
    secret.drawText("B", { font: f });
    // Un signet vers la page supprimée ne doit pas la retenir.
    const ctx = d.context;
    const out = ctx.nextRef();
    const item = ctx.register(ctx.obj({ Title: PDFHexOf("x"), Parent: out, Dest: [secret.ref, "Fit"] } as never));
    ctx.assign(out, ctx.obj({ Type: "Outlines", First: item, Last: item, Count: 1 } as never));
    d.catalog.set(PDFName.of("Outlines"), out);
    const s = await d.save({ useObjectStreams: false });
    const size = async (b: Uint8Array) => (await PDFDocument.load(b)).context.enumerateIndirectObjects().length;
    const b = await P.rearrange(s, [0]);
    expect(await size(b)).toBeLessThan(await size(s));
    const doc = await PDFDocument.load(b);
    const pagesInFile = doc.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of("Type")) === PDFName.of("Page"));
    expect(pagesInFile.length).toBe(1);
    expect(await pageTexts(b)).toEqual(["A"]);
  });
  it("refuse un document sans page", async () => {
    await expect(P.rearrange(await sample(1), [])).rejects.toThrow(/au moins une page/);
  });
  it("garde les attributs hérités quand l'arbre change", async () => {
    const raw = rawPdf("BT /F1 12 Tf 10 10 Td (Un) Tj ET");
    expect(await info(raw)).toEqual([{ w: 500, h: 400, r: 90 }, { w: 500, h: 400, r: 90 }]);
    const b = await P.rearrange(raw, [1]);
    expect(await info(b)).toEqual([{ w: 500, h: 400, r: 90 }]);
    expect(await textOf(b)).toBe("Deux");
    expect(await pageTexts(await P.rearrange(raw, [1, 0]))).toEqual(["Deux", "Un"]);
  });
  it("insère une page vierge de la même taille", async () => {
    const b = await P.insertBlank(await sample(2, [300, 400]), 1, "same");
    expect((await info(b)).map((p) => p.h)).toEqual([400, 400, 400]);
    expect(await pageTexts(b)).toEqual(["Page 1", "", "Page 2"]);
  });
  it("tourne en cumulant la rotation", async () => {
    const b = await P.rotatePages(await P.rotatePages(await sample(2), [1], 90), [1], 90);
    expect((await info(b)).map((p) => p.r)).toEqual([0, 180]);
    expect((await info(await P.rotatePages(b, [0], -90))).map((p) => p.r)).toEqual([270, 180]);
  });
  it("recadre selon la page affichée, même tournée", async () => {
    const b = await P.cropPages(await sample(1), [0], { top: 10, right: 20, bottom: 30, left: 40 });
    expect(await info(b)).toEqual([{ w: 552, h: 752, r: 0 }]);
    const t = await P.rotatePages(await sample(1), [0], 90);
    const c = await P.cropPages(t, [0], { top: 10, right: 20, bottom: 30, left: 40 });
    expect(await info(c)).toEqual([{ w: 792 - 60, h: 612 - 40, r: 90 }]);
    await expect(P.cropPages(await sample(1), [0], { top: 400, right: 0, bottom: 400, left: 0 })).rejects.toThrow(/dépassent/);
  });
});

describe("fusion et découpe", () => {
  it("fusionne dans l'ordre, choix de pages et signets", async () => {
    const b = await P.merge([
      { bytes: await sample(2), name: "Premier.pdf" },
      { bytes: await sample(3), name: "Second.pdf", pages: [2] },
    ], { bookmarks: true, title: "Fusion" });
    expect(await pageTexts(b)).toEqual(["Page 1", "Page 2", "Page 3"]);
    const d = await load(b);
    const o = await d.getOutline();
    expect(o?.map((i) => i.title)).toEqual(["Premier", "Second"]);
    const dest = o![1].dest as unknown[];
    expect(await d.getPageIndex(dest[0] as never)).toBe(2);
    await d.loadingTask.destroy();
  });
  it("fusionne des tailles et des arbres différents", async () => {
    const b = await P.merge([{ bytes: rawPdf("BT /F1 12 Tf 10 10 Td (Un) Tj ET"), name: "a" }, { bytes: await sample(1, [100, 100]), name: "b" }]);
    expect(await info(b)).toEqual([{ w: 500, h: 400, r: 90 }, { w: 500, h: 400, r: 90 }, { w: 100, h: 100, r: 0 }]);
  });
  it("nomme le fichier fautif", async () => {
    await expect(P.merge([{ bytes: new TextEncoder().encode("pas un pdf"), name: "cassé.pdf" }])).rejects.toThrow(/cassé\.pdf/);
  });
  it("insère les pages d'un autre PDF", async () => {
    const r = await P.insertFrom(await sample(2), 1, await sample(3), [2]);
    expect(r.count).toBe(1);
    expect(await pageTexts(r.bytes)).toEqual(["Page 1", "Page 3", "Page 2"]);
  });
  it("découpe", async () => {
    const parts = await P.split(await sample(5), P.everyN(5, 2));
    expect(await Promise.all(parts.map(pageTexts))).toEqual([["Page 1", "Page 2"], ["Page 3", "Page 4"], ["Page 5"]]);
  });
});

describe("numérotation, filigrane, métadonnées", () => {
  it("numérote les pages choisies", async () => {
    const b = await P.addPageNumbers(await sample(3), [1, 2], { template: "{n} / {t}", position: "bottom-center", size: 10, margin: 20, start: 1, color: [0, 0, 0] });
    expect(await pageTexts(b)).toEqual(["Page 1", "Page 2 1 / 2", "Page 3 2 / 2"]);
  });
  it("écrit le filigrane droit sur une page tournée", async () => {
    const b = await P.addWatermark(await P.rotatePages(await sample(1), [0], 90), [0], { text: "ÉBAUCHE", size: 40, opacity: 0.3, color: [1, 0, 0], diagonal: false });
    const d = await load(b);
    const page = await d.getPage(1);
    const c = await page.getTextContent();
    const it = c.items.find((i) => "str" in i && i.str === "ÉBAUCHE") as { transform: number[]; width: number };
    // Une fois la page affichée (rotation 90), le texte est horizontal et centré.
    const v = page.getViewport({ scale: 1 });
    const [sx, sy] = v.convertToViewportPoint(it.transform[4], it.transform[5]);
    expect(Math.abs(sx + it.width / 2 - v.width / 2)).toBeLessThan(2);
    expect(Math.abs(sy - v.height / 2)).toBeLessThan(40);
    await d.loadingTask.destroy();
  });
  it("lit et écrit les métadonnées", async () => {
    const b = await P.setMetadata(await sample(1), { title: "Été", author: "Auteur", subject: "Sujet", keywords: "a, b" });
    expect(await P.getMetadata(b)).toMatchObject({ title: "Été", author: "Auteur", subject: "Sujet" });
    const d = await load(b);
    const m = await d.getMetadata();
    expect((m.info as { Title: string }).Title).toBe("Été");
    await d.loadingTask.destroy();
  });
});

describe("objets ajoutés", () => {
  const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/7yMK/gAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
  const text = (over: Partial<Extract<PageObject, { kind: "text" }>> = {}): PageObject => ({
    id: "t", kind: "text", x: 100, y: 500, w: 200, h: 40, angle: 0, text: "Bonjour été", family: "Times", bold: true, italic: false, size: 14, color: [0, 0, 1], align: "left", ...over,
  });
  it("écrit texte, image et formes", async () => {
    const objs: PageObject[] = [
      text(),
      { id: "i", kind: "image", x: 10, y: 700, w: 50, h: 50, angle: 0, bytes: png, mime: "image/png" },
      { id: "r", kind: "rect", x: 10, y: 100, w: 50, h: 50, angle: 30, stroke: [1, 0, 0], fill: null, strokeWidth: 2, opacity: 1 },
      { id: "e", kind: "ellipse", x: 100, y: 100, w: 50, h: 30, angle: 0, stroke: null, fill: [0, 1, 0], strokeWidth: 1, opacity: 0.5 },
      { id: "l", kind: "line", x: 200, y: 100, w: 50, h: -30, angle: 0, stroke: [0, 0, 0], fill: null, strokeWidth: 1, opacity: 1 },
      { id: "h", kind: "highlight", x: 72, y: 720, w: 100, h: 24, angle: 0, color: [1, 1, 0] },
      { id: "w", kind: "whiteout", x: 300, y: 300, w: 10, h: 10, angle: 0, color: [1, 1, 1] },
    ];
    const b = await flatten(await sample(2), [[1, objs]]);
    expect(await textOf(b, 1)).toBe("Page 1");
    expect(await textOf(b, 2)).toBe("Page 2 Bonjour été");
    const d = await load(b);
    const c = await (await d.getPage(2)).getTextContent();
    const it = c.items.find((i) => "str" in i && i.str.startsWith("Bonjour")) as { transform: number[] };
    expect(it.transform[4]).toBeCloseTo(100, 0);
    expect(it.transform[5]).toBeCloseTo(500 - 0.9375 * 14, 0);
    await d.loadingTask.destroy();
  });
  it("garde le texte droit quand l'angle suit la page", async () => {
    const b = await flatten(await P.rotatePages(await sample(1), [0], 90), [[0, [text({ x: 100, y: 100, angle: 90 })]]]);
    const d = await load(b);
    const c = await (await d.getPage(1)).getTextContent();
    const it = c.items.find((i) => "str" in i && i.str.startsWith("Bonjour")) as { transform: number[] };
    expect(it.transform[1]).toBeGreaterThan(0);
    expect(Math.abs(it.transform[0])).toBeLessThan(0.001);
    await d.loadingTask.destroy();
  });
  it("ne réécrit rien sans objet", async () => {
    const s = await sample(1);
    expect(await flatten(s, [[0, []]])).toBe(s);
  });
  it("coupe les lignes à la largeur de la boîte", () => {
    const base = { family: "Helvetica", bold: false, italic: false, size: 10 } as const;
    expect(wrapLines({ ...base, w: 1000, text: "a b\nc" })).toEqual(["a b", "c"]);
    expect(wrapLines({ ...base, w: 30, text: "alpha beta" })).toEqual(["alpha", "beta"]);
    expect(wrapLines({ ...base, w: 20, text: "abcdefghij" }).length).toBeGreaterThan(1);
    expect(wrapLines({ ...base, w: 20, text: "abcdefghij" }).join("")).toBe("abcdefghij");
    expect(wrapLines({ ...base, w: 100, text: "a\n\nb" })).toEqual(["a", "", "b"]);
  });
  it("signale les caractères impossibles", async () => {
    expect(unsupportedChar("Été œuvre €")).toBeNull();
    expect(unsupportedChar("日本")).toBe("日");
    await expect(flatten(await sample(1), [[0, [text({ text: "日本" })]]])).rejects.toThrow(/日/);
  });
});

describe("flux de contenu", () => {
  it("découpe opérandes et opérateurs", () => {
    const c = "q 1 0 0 1 .5 -2 cm BT /F1 12 Tf (a\\(b\\)\\101) Tj [<0041> -20 (c)] TJ ET Q";
    const ins = parseContent(new TextEncoder().encode(c));
    expect(ins.map((i) => i.op)).toEqual(["q", "cm", "BT", "Tf", "Tj", "TJ", "ET", "Q"]);
    expect(ins[1].args).toEqual([1, 0, 0, 1, 0.5, -2]);
    expect(new TextDecoder().decode((ins[4].args[0] as { str: Uint8Array }).str)).toBe("a(b)A");
    expect(c.slice(ins[4].start, ins[4].end)).toBe("(a\\(b\\)\\101) Tj");
  });
  it("saute les images en ligne et les dictionnaires", () => {
    const c = "/P <</MCID 0>> BDC BI /W 1 /H 1 ID \x00 Tj EI EMC BT ET";
    expect(parseContent(Uint8Array.from(c, (x) => x.charCodeAt(0))).map((i) => i.op)).toEqual(["BDC", "BI", "EMC", "BT", "ET"]);
  });
});

describe("modification du texte existant", () => {
  const stream = (b: string) => rawPdf(b);
  it("repère les suites de texte et leur position", async () => {
    const b = stream("q 2 0 0 2 10 20 cm BT 0 0 1 rg /F1 12 Tf 5 7 Td (Bonjour le) Tj ( monde) Tj ET Q BT /F1 12 Tf 100 200 Td (Ailleurs) Tj ET");
    const runs = await listRuns(b, 0);
    expect(runs.map((r) => r.text)).toEqual(["Bonjour le monde", "Ailleurs"]);
    expect(runs[0].x).toBeCloseTo(20);
    expect(runs[0].y).toBeCloseTo(34);
    expect(runs[0].size).toBeCloseTo(24);
    expect(runs[0].color).toEqual([0, 0, 1]);
    expect(runs[0].family).toBe("Times");
  });
  it("les espaces par décalage deviennent des espaces", async () => {
    const runs = await listRuns(stream("BT /F1 10 Tf 10 10 Td [(mot) -400 (deux) -40 (x)] TJ ET"), 0);
    expect(runs[0].text).toBe("mot deuxx");
  });
  it("ignore le texte invisible (couche de reconnaissance)", async () => {
    expect(await listRuns(stream("BT /F1 10 Tf 3 Tr 10 10 Td (cache) Tj ET BT /F1 10 Tf 0 Tr 10 30 Td (vu) Tj ET"), 0)).toMatchObject([{ text: "vu" }]);
  });
  it("sépare les styles et les colonnes", async () => {
    const r = await listRuns(stream("BT /F1 10 Tf 10 10 Td (a) Tj ET BT /F1 20 Tf 15 10 Td (b) Tj ET BT /F1 20 Tf 300 10 Td (c) Tj ET"), 0);
    expect(r.map((x) => x.text)).toEqual(["a", "b", "c"]);
  });
  it("remplace le texte : l'ancien disparaît, le reste ne bouge pas", async () => {
    const b = stream("BT /F1 12 Tf 10 100 Td (Ancien texte) Tj 0 -20 Td (Ligne suivante) Tj ET");
    const runs = await listRuns(b, 0);
    expect(runs.map((r) => r.text)).toEqual(["Ancien texte", "Ligne suivante"]);
    const r = await editRun(b, 0, runs[0].id, { text: "Nouveau été" });
    expect(r.sameFont).toBe(true);
    expect(await textOf(r.bytes)).toBe("Nouveau été Ligne suivante");
    const after = await listRuns(r.bytes, 0);
    expect(after.find((x) => x.text === "Ligne suivante")!.y).toBeCloseTo(80);
    expect(after.find((x) => x.text === "Ligne suivante")!.x).toBeCloseTo(10);
    const raw = await PDFDocument.load(r.bytes);
    expect(new TextDecoder("latin1").decode(await raw.save({ useObjectStreams: false }))).not.toContain("Ancien");
  });
  it("garde la place du texte qui suit sans repositionnement", async () => {
    // Autre style ensuite (corps 20) : deux suites distinctes dans le même BT.
    const b = stream("BT /F1 12 Tf 10 50 Td (AAAA) Tj /F1 20 Tf (fixe) Tj ET");
    const runs = await listRuns(b, 0);
    expect(runs.map((r) => r.text)).toEqual(["AAAA", "fixe"]);
    const r = await editRun(b, 0, runs[0].id, { text: "A" });
    const after = await listRuns(r.bytes, 0);
    expect(after[1].text).toBe("fixe");
    expect(after[1].x).toBeCloseTo(runs[1].x, 2);
    // Même chose quand la suite est retirée.
    const gone = await editRun(b, 0, runs[0].id, { text: "" });
    expect((await listRuns(gone.bytes, 0))[0].x).toBeCloseTo(runs[1].x, 2);
  });
  it("gère ' et \"", async () => {
    const b = stream("BT /F1 12 Tf 14 TL 10 100 Td (a) ' 1 2 (b) \" (c) ' ET");
    const runs = await listRuns(b, 0);
    expect(runs.map((r) => [r.text, Math.round(r.y)])).toEqual([["a", 86], ["b", 72], ["c", 58]]);
    const r = await editRun(b, 0, runs[0].id, { text: "z" });
    expect((await listRuns(r.bytes, 0)).map((x) => [x.text, Math.round(x.y)])).toEqual([["z", 86], ["b", 72], ["c", 58]]);
  });
  it("supprime le texte quand il est vidé", async () => {
    const b = stream("BT /F1 12 Tf 10 100 Td (A) Tj 0 -20 Td (B) Tj ET");
    const r = await editRun(b, 0, (await listRuns(b, 0))[0].id, { text: "" });
    expect(await textOf(r.bytes)).toBe("B");
  });
  it("police réduite : réutilisée si les caractères y sont, remplacée sinon", async () => {
    const font = "/Subtype /Type1 /BaseFont /ABCDEF+Garamond-Bold /FirstChar 65 /LastChar 67 /Widths [700 700 700] /Encoding /WinAnsiEncoding";
    const b = rawPdf("BT 0.5 g /F1 12 Tf 10 100 Td (ABC) Tj ET", font);
    const runs = await listRuns(b, 0);
    expect(runs[0]).toMatchObject({ text: "ABC", family: "Times", bold: true, fontName: "Garamond-Bold" });
    const same = await editRun(b, 0, runs[0].id, { text: "CAB" });
    expect(same.sameFont).toBe(true);
    const other = await editRun(b, 0, runs[0].id, { text: "Xyz" });
    expect(other.sameFont).toBe(false);
    expect(other.fontName).toBe("Times-Bold");
    expect(await textOf(other.bytes)).toBe("Xyz");
    const [r] = await listRuns(other.bytes, 0);
    expect(r.color[0]).toBeCloseTo(0.5);
    expect(r.x).toBeCloseTo(10);
    expect(r.y).toBeCloseTo(100);
  });
  it("police composite (Identity-H) avec ToUnicode", async () => {
    // Construite avec pdf-lib à partir d'objets bruts : codes 2 octets.
    const d = await PDFDocument.create();
    const page = d.addPage([300, 300]);
    const ctx = d.context;
    const cmap = "/CIDInit /ProcSet findresource begin begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfchar <0003> <0041> <0004> <0042> endbfchar 1 beginbfrange <0005> <0006> <0043> endbfrange endcmap";
    const tu = ctx.register(ctx.stream(cmap));
    const cid = ctx.obj({ Type: "Font", Subtype: "CIDFontType2", BaseFont: "AAAAAA+Test", CIDSystemInfo: { Registry: PDFHexOf("Adobe"), Ordering: PDFHexOf("Identity"), Supplement: 0 }, DW: 500, W: [3, [600, 700]] } as never);
    const f = ctx.register(ctx.obj({ Type: "Font", Subtype: "Type0", BaseFont: "AAAAAA+Test", Encoding: "Identity-H", DescendantFonts: [ctx.register(cid)], ToUnicode: tu } as never));
    page.node.setFontDictionary(PDFName.of("F1"), f);
    page.node.set(PDFName.of("Contents"), ctx.register(ctx.stream("BT /F1 10 Tf 10 10 Td <00030004> Tj ET")));
    const b = await d.save({ useObjectStreams: false });
    const runs = await listRuns(b, 0);
    expect(runs[0].text).toBe("AB");
    expect(runs[0].width).toBeCloseTo(13);
    const r = await editRun(b, 0, runs[0].id, { text: "DA" });
    expect(r.sameFont).toBe(true);
    expect((await listRuns(r.bytes, 0))[0].text).toBe("DA");
    expect((await listRuns(r.bytes, 0))[0].width).toBeCloseTo(11);
  });
  it("style imposé : police standard, taille et couleur", async () => {
    const b = stream("BT /F1 12 Tf 10 100 Td (Texte) Tj ET");
    const r = await editRun(b, 0, (await listRuns(b, 0))[0].id, { text: "Texte", size: 30, color: [1, 0, 0], bold: true });
    const [x] = await listRuns(r.bytes, 0);
    expect(x).toMatchObject({ text: "Texte", color: [1, 0, 0] });
    expect(x.size).toBeCloseTo(30);
  });
  it("refuse un caractère impossible sans rien changer", async () => {
    const b = stream("BT /F1 12 Tf 10 100 Td (Texte) Tj ET");
    await expect(editRun(b, 0, 0, { text: "日本" })).rejects.toThrow(/日/);
  });
  it("texte produit par pdf-lib (dessin ajouté)", async () => {
    const s = await sample(1);
    const runs = await listRuns(s, 0);
    expect(runs[0].text).toBe("Page 1");
    const r = await editRun(s, 0, runs[0].id, { text: "Page Un" });
    expect(await textOf(r.bytes)).toBe("Page Un");
  });
  it("le document modifié reste modifiable", async () => {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.TimesRoman);
    d.addPage([200, 200]).drawText("Alpha", { x: 10, y: 10, size: 12, font: f, color: rgb(1, 0, 0) });
    let b = await d.save();
    for (const t of ["Beta", "Gamma", "Delta"]) b = (await editRun(b, 0, (await listRuns(b, 0))[0].id, { text: t })).bytes;
    expect(await textOf(b)).toBe("Delta");
    expect((await listRuns(b, 0))[0].color).toEqual([1, 0, 0]);
  });
});

import { PDFHexString } from "pdf-lib";
function PDFHexOf(s: string) {
  return PDFHexString.fromText(s);
}
