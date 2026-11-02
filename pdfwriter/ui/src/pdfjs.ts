// PDF.js (Mozilla, licence Apache 2.0) : affichage, recherche, formulaires.
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

export function assetUrl(dir: string) {
  return new URL(`/pdfjs/${dir}/`, window.location.href).href;
}

export function documentOptions(data: Uint8Array, password?: string) {
  return {
    // PDF.js prend possession du tampon : on lui donne une copie.
    data: data.slice(),
    password,
    cMapUrl: assetUrl("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: assetUrl("standard_fonts"),
    wasmUrl: assetUrl("wasm"),
    iccUrl: assetUrl("iccs"),
  };
}
