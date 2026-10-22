// Chargement de PDF.js (Mozilla, licence Apache 2.0) pour AuxiPDF : la
// bibliothèque, son fil de travail (worker) et les composants d'affichage.
// Chargés à la demande : les autres applications ne les téléchargent pas.

import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export type PdfLib = typeof import("pdfjs-dist");
export type PdfViewerLib = typeof import("pdfjs-dist/web/pdf_viewer.mjs");

let loading: Promise<{ lib: PdfLib; viewer: PdfViewerLib }> | null = null;

export function loadPdfjs() {
  loading ??= (async () => {
    const lib = await import("pdfjs-dist");
    lib.GlobalWorkerOptions.workerSrc = workerUrl;
    // Les composants d'affichage lisent la bibliothèque dans globalThis.
    (globalThis as unknown as { pdfjsLib: PdfLib }).pdfjsLib = lib;
    const viewer = await import("pdfjs-dist/web/pdf_viewer.mjs");
    await import("pdfjs-dist/web/pdf_viewer.css");
    return { lib, viewer };
  })();
  return loading;
}

/** Ressources de PDF.js copiées dans public/pdfjs (voir pdfjs-assets.mjs) :
 * jeux de caractères CJK, polices standard, décodeurs WebAssembly. */
export function assetUrl(dir: string) {
  return new URL(`/pdfjs/${dir}/`, window.location.href).href;
}
