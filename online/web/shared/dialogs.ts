// Boîtes de dialogue d'AuxiOffice Online, en HTML : messages, questions et
// sélecteur de fichiers de l'espace « Mes fichiers » (remplacent les boîtes
// natives du système de l'application de bureau).

import { baseName, dirName, files, formatSize, joinPath, upload, type Entry } from "./http";
import { fileIcon } from "./icons";

/** Une boîte est ouverte : la barre de menus ignore alors les raccourcis. */
export let modalOpen = 0;

/** Boîte demandée pendant la fermeture de la page (voir window.ts). */
export const dialogProbe = { requested: false };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {}, ...children: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of children) if (c !== null) e.append(c);
  return e;
}

interface Shell {
  root: HTMLDivElement;
  box: HTMLDivElement;
  body: HTMLDivElement;
  actions: HTMLDivElement;
  close: () => void;
}

/** Fond, cadre, titre et rangée de boutons ; Échap appelle `onCancel`. */
function shell(title: string, onCancel: () => void, wide = false): Shell {
  const prevFocus = document.activeElement as HTMLElement | null;
  const root = el("div", { className: "auxi-modal-backdrop" });
  const box = el("div", { className: `auxi-modal${wide ? " wide" : ""}` });
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  const head = el("div", { className: "auxi-modal-head" }, el("span", { textContent: title }));
  const x = el("button", { className: "auxi-modal-x", textContent: "×", title: "Fermer" });
  x.onclick = onCancel;
  head.append(x);
  const body = el("div", { className: "auxi-modal-body" });
  const actions = el("div", { className: "auxi-modal-actions" });
  box.append(head, body, actions);
  root.append(box);
  // Les touches restent dans la boîte (pas de frappe envoyée au document).
  root.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  });
  root.addEventListener("keyup", (e) => e.stopPropagation());
  root.addEventListener("keypress", (e) => e.stopPropagation());
  root.addEventListener("mousedown", (e) => {
    if (e.target === root) e.preventDefault();
  });
  document.body.append(root);
  modalOpen++;
  return {
    root,
    box,
    body,
    actions,
    close: () => {
      root.remove();
      modalOpen--;
      prevFocus?.focus?.({ preventScroll: true });
    },
  };
}

function button(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
  const b = el("button", { className: primary ? "primary" : "secondary", textContent: label });
  b.onclick = onClick;
  return b;
}

export type Kind = "info" | "warning" | "error";

/**
 * Message avec boutons ; retourne le libellé choisi (null : fermé).
 * `buttons` : libellés, le premier est le bouton principal.
 */
export function messageBox(text: string, opts: { title?: string; kind?: Kind; buttons?: string[]; cancel?: string } = {}): Promise<string | null> {
  dialogProbe.requested = true;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      s.close();
      resolve(v);
    };
    const s = shell(opts.title ?? "AuxiOffice", () => finish(opts.cancel ?? null));
    s.box.classList.add(`kind-${opts.kind ?? "info"}`);
    s.body.append(el("div", { className: "auxi-modal-text", textContent: text }));
    const labels = opts.buttons?.length ? opts.buttons : ["OK"];
    const btns = labels.map((l, i) => button(l, i === 0, () => finish(l)));
    // Bouton principal à droite, comme dans les boîtes de l'application.
    s.actions.append(el("span", { className: "spacer" }), ...btns.slice(1).reverse(), btns[0]);
    btns[0].focus();
    s.root.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && document.activeElement?.tagName !== "BUTTON") finish(labels[0]);
    });
  });
}

/** Saisie d'un texte (nom d'un dossier…) ; null : annulé. */
export function prompt(title: string, label: string, value = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const s = shell(title, () => {
      s.close();
      resolve(null);
    });
    const input = el("input", { type: "text", value, className: "auxi-input" });
    s.body.append(el("label", { className: "auxi-field" }, label, input));
    const ok = () => {
      const v = input.value.trim();
      s.close();
      resolve(v || null);
    };
    input.onkeydown = (e) => {
      if (e.key === "Enter") ok();
    };
    s.actions.append(
      el("span", { className: "spacer" }),
      button("Annuler", false, () => {
        s.close();
        resolve(null);
      }),
      button("OK", true, ok),
    );
    input.focus();
    input.select();
  });
}

export interface Field {
  name: string;
  label: string;
  type?: "text" | "email" | "password" | "number" | "checkbox";
  value?: string | boolean;
  placeholder?: string;
}

/**
 * Formulaire de quelques champs ; `check` refuse les valeurs invalides
 * (message affiché, la boîte reste ouverte). null : annulé.
 */
export function form(title: string, fields: Field[], okLabel = "OK", check?: (v: Record<string, string | boolean>) => Promise<string | null> | string | null): Promise<Record<string, string | boolean> | null> {
  return new Promise((resolve) => {
    const s = shell(title, () => {
      s.close();
      resolve(null);
    });
    const inputs = new Map<string, HTMLInputElement>();
    for (const f of fields) {
      const input = el("input", { type: f.type ?? "text", className: f.type === "checkbox" ? "" : "auxi-input", placeholder: f.placeholder ?? "" });
      if (f.type === "checkbox") input.checked = !!f.value;
      else input.value = typeof f.value === "string" ? f.value : "";
      if (f.type === "password") input.autocomplete = "new-password";
      inputs.set(f.name, input);
      s.body.append(f.type === "checkbox" ? el("label", { className: "auxi-check" }, input, f.label) : el("label", { className: "auxi-field column" }, f.label, input));
    }
    const msg = el("div", { className: "auxi-picker-status" });
    s.body.append(msg);
    const ok = button(okLabel, true, async () => {
      const v: Record<string, string | boolean> = {};
      for (const [k, i] of inputs) v[k] = i.type === "checkbox" ? i.checked : i.value;
      ok.disabled = true;
      const err = check ? await check(v) : null;
      ok.disabled = false;
      if (err) {
        msg.textContent = err;
        return;
      }
      s.close();
      resolve(v);
    });
    s.actions.append(
      el("span", { className: "spacer" }),
      button("Annuler", false, () => {
        s.close();
        resolve(null);
      }),
      ok,
    );
    s.root.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") void ok.click();
    });
    [...inputs.values()].find((i) => i.type !== "checkbox")?.focus();
  });
}

/** Petit message passager en bas de la fenêtre. */
export function toast(text: string, ms = 4000) {
  const t = el("div", { className: "auxi-toast", textContent: text });
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

// --- Sélecteur de fichiers -------------------------------------------------------

export interface Filter {
  name: string;
  extensions: string[];
}

export interface PickOptions {
  mode: "open" | "save" | "folder";
  title?: string;
  multiple?: boolean;
  filters?: Filter[];
  defaultPath?: string;
}

const LAST_DIR = "auxi-online-dossier";

function lastDir(): string {
  return sessionStorage.getItem(LAST_DIR) ?? "/Documents";
}

const dateFmt = new Intl.DateTimeFormat("fr-CA", { dateStyle: "short", timeStyle: "short" });

function matches(name: string, f: Filter | null): boolean {
  if (!f || f.extensions.includes("*")) return true;
  const lower = name.toLowerCase();
  return f.extensions.some((x) => lower.endsWith(`.${x.toLowerCase()}`));
}

/** Choix de fichiers (ouvrir), d'un emplacement (enregistrer) ou d'un dossier. */
export function pickFile(opts: PickOptions): Promise<string | string[] | null> {
  dialogProbe.requested = true;
  const save = opts.mode === "save";
  const filters = (opts.filters ?? []).filter((f) => f.extensions.length);
  let filter: Filter | null = filters[0] ?? null;
  let dir = lastDir();
  let defaultName = "";
  if (opts.defaultPath) {
    if (opts.defaultPath.startsWith("/") && !opts.defaultPath.startsWith("/.temp/")) {
      dir = save ? dirName(opts.defaultPath) : opts.defaultPath;
      defaultName = save ? baseName(opts.defaultPath) : "";
    } else {
      defaultName = baseName(opts.defaultPath);
    }
  }
  const title = opts.title ?? (save ? "Enregistrer sous" : opts.mode === "folder" ? "Choisir un dossier" : "Ouvrir");

  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string | string[] | null) => {
      if (done) return;
      done = true;
      if (v) sessionStorage.setItem(LAST_DIR, dir);
      s.close();
      resolve(v);
    };
    const s = shell(title, () => finish(null), true);
    s.box.classList.add("auxi-picker");

    const crumbs = el("div", { className: "auxi-crumbs" });
    const tools = el("div", { className: "auxi-picker-tools" });
    const list = el("div", { className: "auxi-files", tabIndex: 0 });
    const status = el("div", { className: "auxi-picker-status" });
    const fileInput = el("input", { type: "file", multiple: true, hidden: true });
    if (filter && !filter.extensions.includes("*")) fileInput.accept = filter.extensions.map((x) => `.${x}`).join(",");
    s.body.append(el("div", { className: "auxi-picker-bar" }, crumbs, tools), list, status, fileInput);

    const newFolder = button("Nouveau dossier", false, async () => {
      const name = await prompt("Nouveau dossier", "Nom du dossier");
      if (!name) return;
      try {
        await files.mkdir(joinPath(dir, name));
        await load(joinPath(dir, name));
      } catch (e) {
        status.textContent = String(e instanceof Error ? e.message : e);
      }
    });
    const send = button("Téléverser…", false, () => fileInput.click());
    send.title = "Envoyer des fichiers de cet ordinateur dans ce dossier";
    tools.append(newFolder);
    if (opts.mode === "open") tools.append(send);

    const doUpload = async (fl: FileList | File[]) => {
      if (!fl.length) return;
      status.textContent = "Envoi…";
      try {
        const sent = await upload(dir, fl);
        status.textContent = "";
        // Ouvrir : les fichiers envoyés sont aussi choisis.
        if (opts.mode === "open") finish(opts.multiple ? sent : sent[0]);
        else await load(dir);
      } catch (e) {
        status.textContent = `Envoi impossible : ${e instanceof Error ? e.message : e}`;
      }
    };
    fileInput.onchange = () => void doUpload(fileInput.files ?? []);
    list.addEventListener("dragover", (e) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        e.stopPropagation();
        list.classList.add("drop");
      }
    });
    list.addEventListener("dragleave", () => list.classList.remove("drop"));
    list.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      list.classList.remove("drop");
      if (e.dataTransfer?.files.length) void doUpload(e.dataTransfer.files);
    });

    // Rangée du bas : nom (enregistrer), type, boutons.
    const nameInput = el("input", { type: "text", className: "auxi-input", value: defaultName });
    const typeSelect = el("select", { className: "auxi-input" });
    for (const [i, f] of filters.entries()) typeSelect.append(el("option", { value: String(i), textContent: `${f.name} (${f.extensions.map((x) => `.${x}`).join(", ")})` }));
    if (!save) typeSelect.append(el("option", { value: "-1", textContent: "Tous les fichiers" }));
    typeSelect.onchange = () => {
      const i = Number(typeSelect.value);
      filter = i >= 0 ? filters[i] : null;
      if (save && filter && nameInput.value) nameInput.value = nameInput.value.replace(/\.[^.]*$/, "") + `.${filter.extensions[0]}`;
      render();
    };
    const bottom = el("div", { className: "auxi-picker-bottom" });
    if (save) bottom.append(el("label", { className: "auxi-field" }, "Nom", nameInput));
    if (filters.length) bottom.append(el("label", { className: "auxi-field" }, "Type", typeSelect));
    s.body.append(bottom);

    const okLabel = save ? "Enregistrer" : opts.mode === "folder" ? "Choisir" : "Ouvrir";
    const ok = button(okLabel, true, () => void confirm());
    s.actions.append(el("span", { className: "spacer" }), button("Annuler", false, () => finish(null)), ok);

    let entries: Entry[] = [];
    let selected = new Set<string>();

    const confirm = async () => {
      if (save) {
        const name = nameInput.value.trim();
        if (!name || name.includes("/")) {
          status.textContent = "Nom de fichier invalide.";
          return;
        }
        const target = joinPath(dir, name);
        const existing = entries.find((e) => e.name.toLowerCase() === name.toLowerCase());
        if (existing?.dir) return void load(target);
        if (existing && (await messageBox(`« ${name} » existe déjà. Le remplacer ?`, { title, kind: "warning", buttons: ["Remplacer", "Annuler"] })) !== "Remplacer") return;
        return finish(target);
      }
      if (opts.mode === "folder") return finish(selected.size === 1 && entries.find((e) => e.dir && selected.has(e.name)) ? joinPath(dir, [...selected][0]) : dir);
      const chosen = entries.filter((e) => !e.dir && selected.has(e.name)).map((e) => joinPath(dir, e.name));
      if (!chosen.length) {
        const d = entries.find((e) => e.dir && selected.has(e.name));
        if (d) void load(joinPath(dir, d.name));
        return;
      }
      finish(opts.multiple ? chosen : chosen[0]);
    };

    const render = () => {
      crumbs.replaceChildren();
      const parts = dir.split("/").filter(Boolean);
      const root = el("button", { className: "crumb", textContent: "Mes fichiers" });
      root.onclick = () => void load("/");
      crumbs.append(root);
      parts.forEach((p, i) => {
        const b = el("button", { className: "crumb", textContent: p });
        b.onclick = () => void load("/" + parts.slice(0, i + 1).join("/"));
        crumbs.append(el("span", { className: "sep", textContent: "›" }), b);
      });
      list.replaceChildren();
      const shown = entries.filter((e) => e.dir || (opts.mode !== "folder" && matches(e.name, filter)));
      if (!shown.length) list.append(el("div", { className: "auxi-files-empty", textContent: opts.mode === "open" ? "Dossier vide. Glissez des fichiers ici ou utilisez « Téléverser… »." : "Dossier vide." }));
      for (const e of shown) {
        const row = el(
          "div",
          { className: `auxi-file${e.dir ? " dir" : ""}${selected.has(e.name) ? " sel" : ""}` },
          fileIcon(e.name, e.dir),
          el("span", { className: "name", textContent: e.name }),
          el("span", { className: "size", textContent: e.dir ? "" : formatSize(e.size) }),
          el("span", { className: "date", textContent: e.mtime ? dateFmt.format(e.mtime) : "" }),
        );
        row.onclick = (ev) => {
          if (opts.multiple && (ev.ctrlKey || ev.metaKey)) {
            if (selected.has(e.name)) selected.delete(e.name);
            else selected.add(e.name);
          } else selected = new Set([e.name]);
          if (save && !e.dir) nameInput.value = e.name;
          render();
        };
        row.ondblclick = () => {
          if (e.dir) void load(joinPath(dir, e.name));
          else if (save) {
            nameInput.value = e.name;
            void confirm();
          } else if (opts.mode === "open") finish(opts.multiple ? [joinPath(dir, e.name)] : joinPath(dir, e.name));
        };
        list.append(row);
      }
    };

    const load = async (d: string) => {
      status.textContent = "";
      try {
        const r = await files.list(d);
        dir = r.path;
        entries = r.entries;
        selected = new Set();
      } catch (e) {
        if (d !== "/") return void load(d === lastDir() ? "/" : dirName(d));
        status.textContent = String(e instanceof Error ? e.message : e);
      }
      render();
    };

    s.root.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.target === nameInput || e.target === list)) {
        e.preventDefault();
        void confirm();
      } else if (e.key === "Backspace" && e.target === list && dir !== "/") void load(dirName(dir));
    });
    void load(dir).then(() => {
      if (save) {
        nameInput.focus();
        nameInput.setSelectionRange(0, nameInput.value.replace(/\.[^.]*$/, "").length);
      } else list.focus();
    });
  });
}
