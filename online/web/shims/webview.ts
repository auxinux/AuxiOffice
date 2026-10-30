// Remplace @tauri-apps/api/webview : fichiers glissés depuis l'ordinateur,
// envoyés dans « Documents » puis ouverts comme sur le bureau.

import { upload } from "../shared/http";
import { toast } from "../shared/dialogs";
import { getCurrentWindow } from "./window";

type DragPayload = { type: "enter" | "over" | "leave" | "drop"; paths: string[]; position: { x: number; y: number } };
type DragHandler = (e: { payload: DragPayload }) => void;

const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");

class WebWebview {
  readonly label = "main";
  window = getCurrentWindow();
  async onDragDropEvent(h: DragHandler) {
    let depth = 0;
    const pos = (e: DragEvent) => ({ x: e.clientX, y: e.clientY });
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (depth++ === 0) h({ payload: { type: "enter", paths: [], position: pos(e) } });
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      h({ payload: { type: "over", paths: [], position: pos(e) } });
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      if (--depth <= 0) {
        depth = 0;
        h({ payload: { type: "leave", paths: [], position: pos(e) } });
      }
    };
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      depth = 0;
      const list = Array.from(e.dataTransfer?.files ?? []);
      h({ payload: { type: "leave", paths: [], position: pos(e) } });
      if (!list.length) return;
      toast(list.length > 1 ? `Envoi de ${list.length} fichiers dans Documents…` : `Envoi de « ${list[0].name} » dans Documents…`, 2500);
      try {
        const paths = await upload("/Documents", list);
        h({ payload: { type: "drop", paths, position: pos(e) } });
      } catch (err) {
        toast(`Envoi impossible : ${err instanceof Error ? err.message : err}`, 6000);
      }
    };
    document.addEventListener("dragenter", enter);
    document.addEventListener("dragover", over);
    document.addEventListener("dragleave", leave);
    document.addEventListener("drop", drop);
    return () => {
      document.removeEventListener("dragenter", enter);
      document.removeEventListener("dragover", over);
      document.removeEventListener("dragleave", leave);
      document.removeEventListener("drop", drop);
    };
  }
  async setZoom() {}
}

const current = new WebWebview();
export const getCurrentWebview = () => current;
