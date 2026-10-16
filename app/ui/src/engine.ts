// Pont vers la coque Tauri : un document = un processus moteur.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type DocType = "text" | "spreadsheet" | "presentation" | "drawing" | "other";

export interface DocInfo {
  doc: number;
  path: string;
  type: DocType;
  parts: number;
  part: number;
  part_names: string[];
  part_hashes?: string[];
  width: number;
  height: number;
  pages?: string;
  read_only: boolean;
  locked_by: { user: string; host: string; date: string } | null;
  libreoffice?: string | null;
}

export interface EngineEvent {
  doc: number;
  event: string;
  type?: number;
  name?: string;
  payload?: string;
  provided?: boolean;
}

export interface PaintRequest {
  px_w: number;
  px_h: number;
  x: number;
  y: number;
  w: number;
  h: number;
  part?: number;
}

export const openDocument = (path: string, ignoreLock = false) => invoke<DocInfo>("doc_open", { path, ignoreLock });

export const closeDocument = (doc: number) => invoke<void>("doc_close", { doc });

export function call<T = Record<string, unknown>>(doc: number, cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  return invoke<T>("doc_call", { doc, req: { cmd, ...args } });
}

export async function paint(doc: number, req: PaintRequest): Promise<Uint8ClampedArray<ArrayBuffer>> {
  const buf = await invoke<ArrayBuffer>("doc_paint", { doc, req });
  return new Uint8ClampedArray(buf);
}

/** Rendu d'une zone (pixels logiques) d'une fenêtre de LibreOffice. */
export async function paintWindow(doc: number, req: { window: number; x: number; y: number; w: number; h: number; scale: number }): Promise<Uint8ClampedArray<ArrayBuffer>> {
  const buf = await invoke<ArrayBuffer>("doc_paint", { doc, req });
  return new Uint8ClampedArray(buf);
}

export const uno =(doc: number, command: string, args?: Record<string, unknown>, notify = false) =>
  call(doc, "uno", { command, args: args ?? null, notify });

export const newDocument = (kind: "text" | "spreadsheet" | "presentation") => invoke<string>("new_document", { kind });

export const recentFiles = (add?: string) => invoke<string[]>("recent_files", { add: add ?? null });

export const startupFile = () => invoke<string | null>("startup_file");

/** Prépare un moteur d'avance (ouverture plus rapide du document suivant). */
export const warmEngine = () => invoke<void>("warm_engine");

type Listener = (e: EngineEvent) => void;
const listeners = new Map<number, Set<Listener>>();
let unlisten: Promise<UnlistenFn> | null = null;

/** Abonnement aux rappels du moteur d'un document. */
export function onEngineEvent(doc: number, fn: Listener): () => void {
  if (!unlisten) {
    unlisten = listen<EngineEvent>("engine", (ev) => {
      listeners.get(ev.payload.doc)?.forEach((l) => l(ev.payload));
    });
  }
  let set = listeners.get(doc);
  if (!set) listeners.set(doc, (set = new Set()));
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) listeners.delete(doc);
  };
}
