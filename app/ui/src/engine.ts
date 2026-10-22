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

/** Dernière requête en cours de chaque document (toujours résolue). */
const queues = new Map<number, Promise<void>>();

/**
 * Requête au moteur d'un document. Les requêtes d'un document partent dans
 * l'ordre, chacune après la réponse de la précédente : la coque les traite
 * en parallèle, et un appui pouvait arriver après son relâchement, une
 * touche avant la précédente, Entrée avant le texte de la barre de formule.
 * Un enregistrement attend les requêtes précédentes, mais les suivantes ne
 * l'attendent pas (il peut durer, ou attendre une réponse de l'utilisateur).
 */
export function call<T = Record<string, unknown>>(doc: number, cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const before = queues.get(doc) ?? Promise.resolve();
  const p = before.then(() => invoke<T>("doc_call", { doc, req: { cmd, ...args } }));
  if (!cmd.startsWith("save")) {
    const settled = p.then(
      () => undefined,
      () => undefined,
    );
    queues.set(doc, settled);
    void settled.then(() => {
      if (queues.get(doc) === settled) queues.delete(doc);
    });
  }
  return p;
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

export interface AppInfo {
  kind: "office" | "writer" | "sheet" | "present";
  name: string;
}

/** Lancement reçu : fichiers à ouvrir et/ou document vierge. */
export interface Launch {
  files: string[];
  new_doc: boolean;
}

/** Écrit dans `interface.log` (dossier de données) et dans le terminal. */
export const uiLog = (message: string) => void invoke("ui_log", { message }).catch(() => undefined);

export const appInfo = () => invoke<AppInfo>("app_info");
export const takeLaunches = () => invoke<Launch[]>("take_launches");
/** Ouvre une autre application (AuxiSheet…), avec des fichiers ou un document vierge. */
export const launchApp = (kind: AppInfo["kind"], files: string[] = [], newDoc = false) => invoke<void>("launch_app", { kind, files, newDoc });
/** Confie à leur application les fichiers d'un autre type ; retourne ceux à ouvrir ici. */
export const routeFiles = (files: string[]) => invoke<string[]>("route_files", { files });

/** Prévient quand un lancement arrive (second lancement, Finder). */
export const onLaunch = (fn: () => void) => listen("launch", () => fn());

export interface Printer {
  name: string;
  default: boolean;
}

export interface PrintOptions {
  printer: string;
  copies: number;
  sides: string;
  monochrome: boolean;
}

export const listPrinters = () => invoke<Printer[]>("printers");
export const printDocument = (doc: number, title: string, pages: string, options: PrintOptions) => invoke<string>("print_document", { doc, title, pages, options });
export const printWithSystem = (doc: number, title: string, pages: string) => invoke<void>("print_with_system", { doc, title, pages });

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

// --- AuxiCorrect -------------------------------------------------------------

export interface AuxiCorrectOptions {
  enabled: boolean;
  international: boolean;
  variant: "toutes" | "classique" | "1990";
  style: boolean;
  regional: boolean;
}

export interface AuxiCorrectStatus {
  /** Réglage commun d'AuxiCorrect trouvé (AuxiCorrect installé). */
  installed: boolean;
  /** AuxiOffice activé dans AuxiCorrect → Paramètres → Intégration. */
  enabledForAuxiOffice: boolean;
  version: string | null;
  hasApp: boolean;
  settingsFile: string;
  /** Serveur de correction démarré (AuxiWriter). */
  running: boolean;
  /** Les documents ouverts maintenant sont corrigés par AuxiCorrect. */
  active: boolean;
  /** Application autre qu'AuxiWriter (pas de soulignements AuxiCorrect). */
  writerOnly: boolean;
  options: AuxiCorrectOptions;
}

export const auxiCorrectStatus = () => invoke<AuxiCorrectStatus>("auxicorrect_status");
export const setAuxiCorrectOptions = (options: AuxiCorrectOptions) => invoke<AuxiCorrectStatus>("auxicorrect_set_options", { options });
export const openAuxiCorrect = () => invoke<void>("auxicorrect_open_app");
export const auxiCorrectLookup = (what: "definir" | "synonymes" | "antonymes" | "conjuguer", word: string) => invoke<string>("auxicorrect_lookup", { what, word });
