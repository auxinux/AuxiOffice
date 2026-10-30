// Construction de l'interface d'AuxiOffice Online, en quatre passes :
//   --mode portal : portail (connexion, applications, Mes documents) → dist/
//   --mode office : les applications de bureautique (app/ui) → dist/office/
//   --mode text   : AuxiText (text/ui) → dist/text/
//   --mode sheet  : AuxiSheet Lite (IronCalc, entièrement dans le navigateur) → dist/sheet/
//
// Les applications sont celles du bureau, sans aucune copie de leur code :
// les modules de Tauri (@tauri-apps/*) y sont remplacés par les équivalents
// web de shims/ (serveur, WebSocket, boîtes de dialogue et barre de menus HTML).

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { pdfjsAssets } from "../../app/pdfjs-assets.mjs";

const here = __dirname;
const repo = resolve(here, "../..");
const dist = resolve(here, "dist");

const shims = {
  "@tauri-apps/api/core": resolve(here, "shims/core.ts"),
  "@tauri-apps/api/event": resolve(here, "shims/event.ts"),
  "@tauri-apps/api/menu": resolve(here, "shims/menu.ts"),
  "@tauri-apps/api/window": resolve(here, "shims/window.ts"),
  "@tauri-apps/api/webview": resolve(here, "shims/webview.ts"),
  "@tauri-apps/api/webviewWindow": resolve(here, "shims/webviewWindow.ts"),
  "@tauri-apps/api/app": resolve(here, "shims/app.ts"),
  "@tauri-apps/api/path": resolve(here, "shims/path.ts"),
  "@tauri-apps/plugin-dialog": resolve(here, "shims/dialog.ts"),
};

// Le serveur Rust (auxi-online) pendant le développement : `npm run dev`
// puis http://localhost:5180/ (AUXI_ONLINE_URL pour un autre serveur).
const backend = process.env.AUXI_ONLINE_URL ?? "http://127.0.0.1:8090";
const server = {
  port: 5180,
  fs: { allow: [repo] },
  proxy: { "/api": backend, "/ws": { target: backend.replace(/^http/, "ws"), ws: true } },
};

export default defineConfig(({ mode }) => {
  const common = {
    clearScreen: false,
    resolve: { alias: shims, dedupe: ["react", "react-dom"] },
    server,
    define: { __AUXI_ONLINE_APP__: JSON.stringify(mode === "text" ? "text" : "office") },
  };
  if (mode === "office") {
    return {
      ...common,
      root: resolve(repo, "app/ui"),
      base: "/office/",
      plugins: [react(), pdfjsAssets()],
      build: { outDir: resolve(dist, "office"), emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 1500 },
    };
  }
  if (mode === "sheet") {
    // AuxiSheet Lite : IronCalc (WebAssembly), sans moteur sur le serveur.
    return {
      ...common,
      root: resolve(here, "sheet"),
      base: "/sheet/",
      publicDir: false as const,
      plugins: [react()],
      build: { outDir: resolve(dist, "sheet"), emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 1500 },
    };
  }
  if (mode === "text") {
    return {
      ...common,
      root: resolve(repo, "text/ui"),
      base: "/text/",
      plugins: [react()],
      build: { outDir: resolve(dist, "text"), emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 1500 },
    };
  }
  return {
    ...common,
    root: resolve(here, "portal"),
    base: "/",
    publicDir: resolve(here, "portal/public"),
    build: { outDir: dist, emptyOutDir: false, target: "es2022" },
  };
});
