// Remplace @tauri-apps/plugin-dialog : boîtes HTML et sélecteur de
// fichiers de « Mes fichiers ».

import { messageBox, pickFile, type Filter, type Kind } from "../shared/dialogs";

interface OpenOptions {
  multiple?: boolean;
  directory?: boolean;
  filters?: Filter[];
  defaultPath?: string;
  title?: string;
}

export async function open(o: OpenOptions = {}): Promise<string | string[] | null> {
  return pickFile({ mode: o.directory ? "folder" : "open", multiple: o.multiple, filters: o.filters, defaultPath: o.defaultPath, title: o.title });
}

export async function save(o: { filters?: Filter[]; defaultPath?: string; title?: string } = {}): Promise<string | null> {
  return (await pickFile({ mode: "save", filters: o.filters, defaultPath: o.defaultPath, title: o.title })) as string | null;
}

type MsgOpts = string | { title?: string; kind?: Kind; okLabel?: string; cancelLabel?: string; buttons?: Record<string, string> | string };

const norm = (o?: MsgOpts) => (typeof o === "string" ? { title: o } : (o ?? {}));

export async function ask(text: string, o?: MsgOpts): Promise<boolean> {
  const p = norm(o);
  const yes = p.okLabel ?? "Oui";
  return (await messageBox(text, { title: p.title, kind: p.kind, buttons: [yes, p.cancelLabel ?? "Non"] })) === yes;
}

export async function confirm(text: string, o?: MsgOpts): Promise<boolean> {
  const p = norm(o);
  const yes = p.okLabel ?? "OK";
  return (await messageBox(text, { title: p.title, kind: p.kind, buttons: [yes, p.cancelLabel ?? "Annuler"] })) === yes;
}

/** Message ; avec `buttons` ({yes, no, cancel} ou {ok, cancel}), retourne le libellé choisi. */
export async function message(text: string, o?: MsgOpts): Promise<string> {
  const p = norm(o);
  const b = p.buttons;
  if (b && typeof b === "object") {
    const labels = [b.yes ?? b.ok, b.no, b.cancel].filter((x): x is string => !!x);
    return (await messageBox(text, { title: p.title, kind: p.kind, buttons: labels, cancel: b.cancel })) ?? b.cancel ?? "Cancel";
  }
  await messageBox(text, { title: p.title, kind: p.kind, buttons: [p.okLabel ?? "OK"] });
  return "Ok";
}
