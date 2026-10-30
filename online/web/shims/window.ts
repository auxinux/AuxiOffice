// Remplace @tauri-apps/api/window : la « fenêtre » est l'onglet du navigateur.

import { dialogProbe } from "../shared/dialogs";
import { listen as listenEvent, type UnlistenFn } from "./event";

type CloseHandler = (e: { preventDefault: () => void }) => void | Promise<void>;
const closeHandlers = new Set<CloseHandler>();

// Fermeture de l'onglet : le navigateur ne peut pas attendre une réponse
// asynchrone. La demande est jugée nécessaire si un gestionnaire ouvre une
// boîte de dialogue, ou si le titre signale des modifications (« • »).
let probing = 0;
window.addEventListener("beforeunload", (e) => {
  if (!closeHandlers.size) return;
  dialogProbe.requested = false;
  // Un gestionnaire qui ferme la fenêtre dans la foulée ne doit pas
  // quitter la page si l'utilisateur choisit d'y rester.
  probing = Date.now();
  for (const h of closeHandlers) {
    try {
      void h({ preventDefault: () => undefined });
    } catch {
      /* rien */
    }
  }
  if (dialogProbe.requested || document.title.startsWith("• ")) {
    e.preventDefault();
    e.returnValue = "";
  }
});

class WebWindow {
  readonly label = "main";
  async setTitle(t: string) {
    document.title = t;
  }
  async title() {
    return document.title;
  }
  async setTheme() {}
  async theme() {
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  async onCloseRequested(h: CloseHandler): Promise<UnlistenFn> {
    closeHandlers.add(h);
    return () => void closeHandlers.delete(h);
  }
  async onFocusChanged(h: (e: { payload: boolean }) => void): Promise<UnlistenFn> {
    const f = () => h({ payload: true });
    const b = () => h({ payload: false });
    window.addEventListener("focus", f);
    window.addEventListener("blur", b);
    return () => {
      window.removeEventListener("focus", f);
      window.removeEventListener("blur", b);
    };
  }
  async onThemeChanged(h: (e: { payload: "dark" | "light" }) => void): Promise<UnlistenFn> {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const f = () => h({ payload: mq.matches ? "dark" : "light" });
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }
  async onResized(h: () => void): Promise<UnlistenFn> {
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }
  async onMoved(): Promise<UnlistenFn> {
    return () => undefined;
  }
  async onScaleChanged(): Promise<UnlistenFn> {
    return () => undefined;
  }
  async listen<T>(event: string, h: (e: { payload: T }) => void) {
    return listenEvent<T>(event, h);
  }
  async setFullscreen(on: boolean) {
    if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen().catch(() => undefined);
    else if (!on && document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
  }
  async isFullscreen() {
    return !!document.fullscreenElement;
  }
  async scaleFactor() {
    return devicePixelRatio;
  }
  async isFocused() {
    return document.hasFocus();
  }
  async isMaximized() {
    return true;
  }
  async isMinimized() {
    return false;
  }
  async isVisible() {
    return document.visibilityState === "visible";
  }
  async setFocus() {
    window.focus();
  }
  async show() {}
  async hide() {}
  async unminimize() {}
  async minimize() {}
  async maximize() {}
  async toggleMaximize() {}
  async setSize() {}
  async center() {}
  async close() {
    if (Date.now() - probing < 2000) return;
    closeHandlers.clear();
    window.close();
    // Onglet non ouvert par un script : retour au portail.
    setTimeout(() => (location.href = "/"), 150);
  }
  async destroy() {
    return this.close();
  }
}

const current = new WebWindow();
export const getCurrentWindow = () => current;
export const getAllWindows = async () => [current];
export type Window = WebWindow;
export type { UnlistenFn };
