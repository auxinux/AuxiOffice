// Ressources de PDF.js (AuxiPDF) copiées dans ui/public/pdfjs au démarrage de
// Vite : jeux de caractères, polices standard, décodeurs WebAssembly, profils ICC.
import { cpSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function pdfjsAssets() {
  return {
    name: "auxi-pdfjs-assets",
    buildStart() {
      const src = resolve(here, "node_modules/pdfjs-dist");
      for (const d of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
        if (existsSync(resolve(src, d))) cpSync(resolve(src, d), resolve(here, "ui/public/pdfjs", d), { recursive: true });
      }
    },
  };
}
