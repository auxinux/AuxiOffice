/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "ui",
  plugins: [react()],
  clearScreen: false,
  // 5174 : AuxiOffice ; 5175 : AuxiText.
  server: { port: 5175, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 800 },
  test: { root: "ui", environment: "node" },
});
