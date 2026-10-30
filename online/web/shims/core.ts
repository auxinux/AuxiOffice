// Remplace @tauri-apps/api/core : les commandes de la coque de bureau
// (lib.rs d'AuxiOffice et d'AuxiText) sont rendues par le serveur
// (fichiers, moteurs de documents par WebSocket) ou par le navigateur
// (impression, liens, encodages d'AuxiText en WebAssembly).

import { appFor, appName, extension, launch, officeKindFor, type OfficeKind } from "../shared/apps";
import { files, HttpError, postJson } from "../shared/http";
import * as ws from "../shared/ws";
import { dispatch } from "./event";
import "../shared/online.css";

declare const __AUXI_ONLINE_APP__: "office" | "text";

type Args = Record<string, unknown> | Uint8Array | undefined;
type Opts = { headers?: Record<string, string> };

ws.onEngineEvent((p) => dispatch("engine", p));

// --- Application lancée et fichiers demandés par l'adresse ------------------------

const params = new URLSearchParams(location.search);
const OFFICE_KINDS: OfficeKind[] = ["office", "writer", "sheet", "present", "draw", "pdf"];
const kind: OfficeKind = OFFICE_KINDS.includes(params.get("app") as OfficeKind) ? (params.get("app") as OfficeKind) : "office";
let launches: { files: string[]; new_doc: boolean }[] | null = [{ files: params.getAll("open"), new_doc: params.get("new") === "1" }];
// L'adresse est nettoyée : recharger la page ne rouvre pas les fichiers.
if (params.has("open") || params.has("new")) history.replaceState(null, "", location.pathname + (kind !== "office" ? `?app=${kind}` : ""));

function takeLaunches() {
  const l = launches ?? [];
  launches = null;
  return l.filter((x) => x.files.length || x.new_doc);
}

// --- Impression par le navigateur ---------------------------------------------------

/** Imprime un PDF par la boîte d'impression du navigateur (cadre invisible). */
async function printPdf(url: string) {
  const blob = await (await fetch(url, { credentials: "same-origin" })).blob();
  const src = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0";
  frame.src = src;
  document.body.append(frame);
  await new Promise<void>((resolve) => {
    frame.onload = () => {
      setTimeout(() => {
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
        } catch {
          window.open(src, "_blank");
        }
        resolve();
      }, 300);
    };
  });
  setTimeout(() => {
    frame.remove();
    URL.revokeObjectURL(src);
  }, 120_000);
}

async function documentPdf(doc: number, title: string, pages: string): Promise<string> {
  const r = await ws.request<{ url: string }>("pdf", { doc, title, pages });
  return r.url;
}

// --- AuxiOffice -------------------------------------------------------------------

/** Numéros des PDF (lus par le navigateur) : loin de ceux des moteurs. */
let nextPdf = 1_000_000;

async function recentOffice(add: string | null): Promise<string[]> {
  let list = ((await files.kvGet<string[]>("recents-office").catch(() => null)) ?? []).filter((p) => typeof p === "string");
  if (add && !add.startsWith("/.temp/")) {
    list = [add, ...list.filter((p) => p !== add)].slice(0, 20);
    await files.kvPut("recents-office", list).catch(() => undefined);
  }
  if (!list.length) return [];
  const stats = await files.stat(list).catch(() => list.map(() => ({ exists: true })));
  return list.filter((_, i) => stats[i]?.exists);
}

interface AcState {
  available: boolean;
  version: string | null;
  options: { enabled: boolean; international: boolean; variant: string; style: boolean; regional: boolean };
}

/** AuxiCorrect tourne sur le serveur (s'il y est installé), avec les options du compte. */
function acStatus(st: AcState) {
  const writerOnly = kind !== "writer" && kind !== "office";
  return {
    installed: st.available,
    enabledForAuxiOffice: st.available,
    version: st.version,
    hasApp: false,
    settingsFile: "",
    running: st.available,
    active: st.available && st.options.enabled && !writerOnly,
    writerOnly,
    options: st.options,
  };
}

async function office(cmd: string, a: Record<string, unknown>, raw: Args, opts?: Opts): Promise<unknown> {
  switch (cmd) {
    case "doc_open":
      return ws.openDoc({ path: a.path, password: a.password ?? null });
    case "doc_call":
      return ws.request("doc_call", { doc: a.doc, req: a.req });
    case "doc_paint":
      return ws.request<ArrayBuffer>("doc_paint", { doc: a.doc, req: a.req });
    case "doc_close":
      return ws.closeDoc(a.doc as number);
    case "warm_engine":
      return void ws.request("warm").catch(() => undefined);
    case "new_document":
      return (await files.newDocument(a.kind as string)).path;
    case "recent_files":
      return recentOffice((a.add as string) ?? null);
    case "pdf_open": {
      const path = a.path as string;
      const [st] = await files.stat([path]);
      if (!st?.exists) throw `« ${path.split("/").pop()} » est introuvable`;
      if (extension(path) !== "pdf") throw "ce fichier n'est pas un document PDF";
      return { doc: ++nextPdf, path, type: "pdf", parts: 0, part: 0, part_names: [], width: 0, height: 0, read_only: false, locked_by: null, size: st.size };
    }
    case "pdf_read":
      return files.read(a.path as string);
    case "pdf_write": {
      const bytes = raw as Uint8Array<ArrayBuffer>;
      const h = opts?.headers ?? {};
      const target = h["x-path"] ? decodeURIComponent(h["x-path"]) : `/.temp/impression/${decodeURIComponent(h["x-temp"] ?? "Document.pdf").replace(/[/\\]/g, "_")}`;
      await files.write(target, new Blob([bytes]));
      return target;
    }
    case "printers":
      return [{ name: "Boîte d'impression du navigateur", default: true }];
    case "print_document":
      await printPdf(await documentPdf(a.doc as number, a.title as string, a.pages as string));
      return "";
    case "print_with_system": {
      // « Aperçu du système » : le PDF dans un nouvel onglet (lecteur du navigateur).
      const tab = window.open("about:blank", "_blank");
      const url = await documentPdf(a.doc as number, a.title as string, a.pages as string);
      const blob = await (await fetch(url, { credentials: "same-origin" })).blob();
      const src = URL.createObjectURL(blob);
      if (tab) tab.location.href = src;
      else window.open(src, "_blank");
      return;
    }
    case "print_file":
      await printPdf(files.url(a.path as string));
      return "";
    case "open_url": {
      const url = String(a.url);
      if (!/^(https?:|mailto:)/i.test(url)) throw `lien non pris en charge : ${url}`;
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    case "ui_log":
      console.warn(a.message);
      return files.log(String(a.message));
    case "app_info":
      return { kind, name: appName(kind) };
    case "take_launches":
      return takeLaunches();
    case "launch_app":
      return launch(a.kind as OfficeKind, (a.files as string[]) ?? [], !!a.newDoc);
    case "route_files": {
      // Comme sur le bureau : AuxiOffice (le lanceur) confie chaque fichier
      // à son application ; chacune confie aux autres ceux d'un autre type.
      const mine: string[] = [];
      const others = new Map<string, string[]>();
      for (const f of a.files as string[]) {
        const k = officeKindFor(f);
        if (kind !== "office" && (k === kind || (kind === "draw" && k === "pdf"))) mine.push(f);
        else others.set(k, [...(others.get(k) ?? []), f]);
      }
      for (const [k, fl] of others) launch(k as OfficeKind, fl);
      return mine;
    }
    case "open_window":
      // Une « fenêtre » par document : un onglet du navigateur.
      return launch(kind, (a.files as string[]) ?? [], !!a.newDoc);
    case "other_windows":
      return 0;
    case "prefs_get": {
      const p = ((await files.kvGet<Record<string, unknown>>("prefs-office").catch(() => null)) ?? {}) as Record<string, unknown>;
      return { ...p, open_mode: p.open_mode === "tabs" ? "tabs" : "windows" };
    }
    case "prefs_set":
      return void (await files.kvPut("prefs-office", a.prefs));
    case "auxicorrect_status":
      return acStatus(await files.auxicorrect());
    case "auxicorrect_set_options":
      return acStatus(await postJson<AcState>("/api/auxicorrect", a.options, "PUT"));
    case "auxicorrect_lookup":
      return (await postJson<{ text: string }>("/api/auxicorrect/lookup", { what: a.what, word: a.word })).text;
    case "auxicorrect_open_app":
      throw "Les réglages avancés d'AuxiCorrect (dictionnaire personnel, mots ignorés) se font dans l'application AuxiCorrect sur un ordinateur.";
  }
  throw `commande non disponible en ligne : ${cmd}`;
}

// --- AuxiText -----------------------------------------------------------------------

interface TextIo {
  decode(bytes: Uint8Array, forced: string): string;
  encode(text: string, encoding: string, bom: boolean, eol: string): Uint8Array;
  large_file(): number;
  max_file(): number;
}

let textio: Promise<TextIo> | null = null;

/** Module Rust des encodages d'AuxiText, compilé en WebAssembly (chargé à la demande). */
function loadTextio(): Promise<TextIo> {
  textio ??= (async () => {
    const m = await import("../wasm/auxitext_textio_wasm.js");
    const url = (await import("../wasm/auxitext_textio_wasm_bg.wasm?url")).default;
    await m.default({ module_or_path: url });
    return m as unknown as TextIo;
  })();
  return textio;
}

/** Erreur du module (JSON `{code, message…}`) → objet attendu par l'interface. */
function textError(e: unknown): unknown {
  if (typeof e === "string") {
    try {
      return JSON.parse(e);
    } catch {
      return { code: "io", message: e };
    }
  }
  if (e instanceof HttpError) return { code: e.status === 404 ? "notfound" : e.status === 403 ? "permission" : "io", message: e.message };
  return { code: "io", message: String(e instanceof Error ? e.message : e) };
}

async function recentText(a: Record<string, unknown>): Promise<string[]> {
  let list = ((await files.kvGet<string[]>("recents-text").catch(() => null)) ?? []).filter((p) => typeof p === "string");
  const before = JSON.stringify(list);
  if (a.clear) list = [];
  if (typeof a.remove === "string") list = list.filter((p) => p !== a.remove);
  if (typeof a.add === "string") list = [a.add, ...list.filter((p) => p !== a.add)].slice(0, 15);
  if (JSON.stringify(list) !== before) await files.kvPut("recents-text", list).catch(() => undefined);
  return list;
}

async function text(cmd: string, a: Record<string, unknown>): Promise<unknown> {
  switch (cmd) {
    case "read_text": {
      const path = a.path as string;
      try {
        const io = await loadTextio();
        const [st] = await files.stat([path]);
        const name = path.split("/").pop();
        if (!st?.exists) throw JSON.stringify({ code: "notfound", message: `« ${path} » : fichier introuvable` });
        if (st.size > io.max_file()) throw JSON.stringify({ code: "huge", message: `« ${name} » est trop volumineux (${Math.round(st.size / 1048576)} Mo) pour AuxiText.`, size: st.size });
        if (st.size > io.large_file() && !a.force) throw JSON.stringify({ code: "large", message: `« ${name} » fait ${Math.round(st.size / 1048576)} Mo : l'ouvrir peut être lent.`, size: st.size });
        const bytes = new Uint8Array(await files.read(path));
        const decoded = JSON.parse(io.decode(bytes, (a.encoding as string) ?? ""));
        return { ...decoded, stat: st, readonly: false };
      } catch (e) {
        throw textError(e);
      }
    }
    case "write_text": {
      try {
        const io = await loadTextio();
        const bytes = io.encode(a.text as string, a.encoding as string, !!a.bom, a.eol as string);
        return await files.write(a.path as string, new Blob([bytes as Uint8Array<ArrayBuffer>]));
      } catch (e) {
        throw textError(e);
      }
    }
    case "stat_files":
      return files.stat(a.paths as string[]);
    case "prefs_load":
      return (await files.kvGet("prefs-text").catch(() => null)) ?? {};
    case "prefs_save":
      return void (await files.kvPut("prefs-text", a.prefs));
    case "recent_files":
      return recentText(a);
    case "take_launches":
      return takeLaunches().flatMap((l) => l.files);
    case "new_window":
      return launch("text", (a.files as string[]) ?? []);
    case "open_in_writer":
      return launch(appFor(a.path as string) === "text" ? "writer" : officeKindFor(a.path as string), [a.path as string]);
    case "app_info":
      return { version: (await files.me().catch(() => ({ version: "" }))).version, writer: true, platform: "web" };
    case "system_theme":
      return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    case "print_page":
      return window.print();
    case "auxicorrect_status": {
      const st = await files.auxicorrect().catch(() => null);
      return { installed: !!st?.available, enabled: !!st?.available, version: st?.version ?? null, hasApp: false };
    }
    case "auxicorrect_check":
      return postJson("/api/auxicorrect/check", { text: a.text, international: !!a.international });
    case "auxicorrect_open":
      throw "Les réglages avancés d'AuxiCorrect se font dans l'application AuxiCorrect sur un ordinateur.";
  }
  throw `commande non disponible en ligne : ${cmd}`;
}

export async function invoke<T>(cmd: string, args?: Args, opts?: Opts): Promise<T> {
  const a = args instanceof Uint8Array || !args ? {} : (args as Record<string, unknown>);
  try {
    return (await (__AUXI_ONLINE_APP__ === "text" ? text(cmd, a) : office(cmd, a, args, opts))) as T;
  } catch (e) {
    // La coque de bureau rejette avec un texte : même forme ici.
    if (e instanceof Error) throw e.message;
    throw e;
  }
}

export const isTauri = () => false;
export const convertFileSrc = (p: string) => files.url(p);
