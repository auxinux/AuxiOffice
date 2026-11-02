/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { pdfjsAssets } from "./pdfjs-assets.mjs";

export default defineConfig({
  root: "ui",
  plugins: [react(), pdfjsAssets()],
  clearScreen: false,
  // 5174 : AuxiOffice ; 5175 : AuxiText ; 5176 : AuxiPDFWriter.
  server: { port: 5176, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 2500 },
  worker: { format: "es" },
  test: { root: "ui", environment: "node" },
});
