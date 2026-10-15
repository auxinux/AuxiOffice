/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "ui",
  plugins: [react()],
  clearScreen: false,
  server: { port: 5174, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
  test: { root: "ui", environment: "node" },
});
