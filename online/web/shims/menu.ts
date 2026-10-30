// Remplace @tauri-apps/api/menu : la barre de menus native devient une barre
// HTML en haut de la page, avec les mêmes menus (actions.ts des applications)
// et leurs raccourcis clavier.

import { modalOpen, toast } from "../shared/dialogs";
import "../shared/online.css";

type Action = (id: string) => void;

interface ItemOpts {
  id?: string;
  text?: string;
  accelerator?: string;
  action?: Action;
  enabled?: boolean;
  checked?: boolean;
}

const IS_MAC = navigator.platform.toLowerCase().includes("mac");
let seq = 0;
let rerender: () => void = () => {};

export class MenuItem {
  readonly id: string;
  text: string;
  accelerator?: string;
  action?: Action;
  enabled: boolean;
  protected constructor(o: ItemOpts) {
    this.id = o.id ?? `item-${++seq}`;
    this.text = o.text ?? "";
    this.accelerator = o.accelerator;
    this.action = o.action;
    this.enabled = o.enabled ?? true;
  }
  static async new(o: ItemOpts) {
    return new MenuItem(o);
  }
  async setText(t: string) {
    this.text = t;
    rerender();
  }
  async setEnabled(b: boolean) {
    this.enabled = b;
    rerender();
  }
  async isEnabled() {
    return this.enabled;
  }
  async setAccelerator(a: string | null) {
    this.accelerator = a ?? undefined;
    rerender();
  }
  async close() {}
}

export class CheckMenuItem extends MenuItem {
  checked: boolean;
  protected constructor(o: ItemOpts) {
    super(o);
    this.checked = o.checked ?? false;
  }
  static override async new(o: ItemOpts) {
    return new CheckMenuItem(o);
  }
  async setChecked(b: boolean) {
    this.checked = b;
    rerender();
  }
  async isChecked() {
    return this.checked;
  }
}

export class PredefinedMenuItem {
  readonly id = `predef-${++seq}`;
  readonly item: string;
  readonly text?: string;
  private constructor(o: { item: string | object; text?: string }) {
    this.item = typeof o.item === "string" ? o.item : Object.keys(o.item)[0];
    this.text = o.text;
  }
  static async new(o: { item: string | object; text?: string }) {
    return new PredefinedMenuItem(o);
  }
  async close() {}
}

type Entry = MenuItem | PredefinedMenuItem | Submenu;

class Container {
  protected list: Entry[] = [];
  async items() {
    return [...this.list];
  }
  async append(items: Entry | Entry[]) {
    this.list.push(...(Array.isArray(items) ? items : [items]));
    rerender();
  }
  async prepend(items: Entry | Entry[]) {
    this.list.unshift(...(Array.isArray(items) ? items : [items]));
    rerender();
  }
  async insert(items: Entry | Entry[], position: number) {
    this.list.splice(position, 0, ...(Array.isArray(items) ? items : [items]));
    rerender();
  }
  async remove(item: Entry) {
    this.list = this.list.filter((i) => i !== item);
    rerender();
  }
  async removeAt(position: number) {
    const [r] = this.list.splice(position, 1);
    rerender();
    return r ?? null;
  }
  async get(id: string) {
    return this.list.find((i) => i.id === id) ?? null;
  }
  entries() {
    return this.list;
  }
}

export class Submenu extends Container {
  readonly id: string;
  text: string;
  enabled: boolean;
  private constructor(o: { id?: string; text: string; items?: Entry[]; enabled?: boolean }) {
    super();
    this.id = o.id ?? `sub-${++seq}`;
    this.text = o.text;
    this.enabled = o.enabled ?? true;
    this.list = [...(o.items ?? [])];
  }
  static async new(o: { id?: string; text: string; items?: Entry[]; enabled?: boolean }) {
    return new Submenu(o);
  }
  async setText(t: string) {
    this.text = t;
    rerender();
  }
  async setEnabled(b: boolean) {
    this.enabled = b;
    rerender();
  }
  async close() {}
}

export class Menu extends Container {
  readonly id = `menu-${++seq}`;
  private constructor(items: Entry[]) {
    super();
    this.list = [...items];
  }
  static async new(o: { items?: Entry[] } = {}) {
    return new Menu(o.items ?? []);
  }
  async setAsAppMenu() {
    install(this);
    return null;
  }
  async setAsWindowMenu() {
    install(this);
    return null;
  }
  async popup() {}
  async close() {}
}

// --- Raccourcis ------------------------------------------------------------------

interface Accel {
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

function parseAccel(a: string): Accel | null {
  const parts = a.split("+").map((p) => p.trim());
  // « Ctrl++ » : la touche est le signe plus.
  if (a.endsWith("++")) parts.splice(parts.length - 2, 2, "Plus");
  const r: Accel = { ctrl: false, meta: false, shift: false, alt: false, key: "" };
  for (const p of parts) {
    const l = p.toLowerCase();
    if (l === "cmdorctrl" || l === "commandorcontrol") IS_MAC ? (r.meta = true) : (r.ctrl = true);
    else if (l === "ctrl" || l === "control") r.ctrl = true;
    else if (l === "cmd" || l === "command" || l === "super" || l === "meta") r.meta = true;
    else if (l === "shift") r.shift = true;
    else if (l === "alt" || l === "option" || l === "altgr") r.alt = true;
    else r.key = l;
  }
  return r.key ? r : null;
}

const KEY_NAMES: Record<string, string[]> = {
  plus: ["+", "NumpadAdd"],
  minus: ["-", "NumpadSubtract"],
  equal: ["="],
  space: [" "],
  enter: ["Enter"],
  return: ["Enter"],
  tab: ["Tab"],
  esc: ["Escape"],
  escape: ["Escape"],
  delete: ["Delete"],
  backspace: ["Backspace"],
  insert: ["Insert"],
  home: ["Home"],
  end: ["End"],
  pageup: ["PageUp"],
  pagedown: ["PageDown"],
  up: ["ArrowUp"],
  down: ["ArrowDown"],
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
};

function keyMatches(k: string, e: KeyboardEvent): boolean {
  if (/^[a-z]$/.test(k)) return e.code === `Key${k.toUpperCase()}`;
  if (/^[0-9]$/.test(k)) return e.code === `Digit${k}` || e.code === `Numpad${k}`;
  if (/^f\d{1,2}$/.test(k)) return e.key.toLowerCase() === k;
  const names = KEY_NAMES[k];
  if (names) return names.includes(e.key) || names.includes(e.code);
  return e.key.toLowerCase() === k;
}

function accelLabel(a?: string): string {
  if (!a) return "";
  return a
    .replace(/CmdOrCtrl|CommandOrControl/gi, IS_MAC ? "⌘" : "Ctrl")
    .replace(/Shift/g, "Maj")
    .replace(/\bPlus\b/g, "+");
}

function walk(list: Entry[], fn: (i: MenuItem) => void) {
  for (const i of list) {
    if (i instanceof Submenu) {
      if (i.enabled) walk(i.entries(), fn);
    } else if (i instanceof MenuItem) fn(i);
  }
}

function editable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
}

// --- Barre HTML ---------------------------------------------------------------------

let current: Menu | null = null;
let bar: HTMLDivElement | null = null;
let openIndex = -1;

function ensureBar(): HTMLDivElement {
  if (bar) return bar;
  bar = document.createElement("div");
  bar.id = "auxi-menubar";
  bar.setAttribute("role", "menubar");
  // Le focus reste dans le document : Couper/Copier agissent sur sa sélection.
  bar.addEventListener("mousedown", (e) => {
    if (!(e.target as HTMLElement).closest("input")) e.preventDefault();
  });
  document.body.prepend(bar);
  document.addEventListener("mousedown", (e) => {
    if (openIndex >= 0 && bar && !bar.contains(e.target as Node)) {
      openIndex = -1;
      render();
    }
  });
  window.addEventListener("blur", () => {
    if (openIndex >= 0) {
      openIndex = -1;
      render();
    }
  });
  window.addEventListener(
    "keydown",
    (e) => {
      if (openIndex >= 0 && e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        openIndex = -1;
        return render();
      }
      if (!current || modalOpen > 0 || e.isComposing) return;
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
      let hit: MenuItem | null = null;
      walk(current.entries(), (i) => {
        if (hit || !i.enabled || !i.accelerator || !i.action) return;
        const a = parseAccel(i.accelerator);
        if (!a || a.ctrl !== e.ctrlKey || a.meta !== e.metaKey || a.shift !== e.shiftKey || a.alt !== e.altKey || !keyMatches(a.key, e)) return;
        // Touche seule (Suppr, F2…) : laissée aux champs de saisie des boîtes.
        if (plain && !/^f\d/.test(a.key) && editable(e.target) && !(e.target as HTMLElement).closest("textarea.ime, .cm-content")) return;
        hit = i;
      });
      const found = hit as MenuItem | null;
      if (found?.action) {
        e.preventDefault();
        e.stopPropagation();
        found.action(found.id);
      }
    },
    true,
  );
  return bar;
}

function install(menu: Menu) {
  current = menu;
  openIndex = -1;
  render();
}

function runPredefined(p: PredefinedMenuItem) {
  switch (p.item) {
    case "Cut":
      document.execCommand("cut");
      break;
    case "Copy":
      document.execCommand("copy");
      break;
    case "Paste":
      toast(`Pour coller, utilisez ${IS_MAC ? "⌘" : "Ctrl"}+V : le navigateur n'autorise pas le collage depuis un menu.`);
      break;
    case "SelectAll":
      document.execCommand("selectAll");
      break;
    case "Fullscreen":
      void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
      break;
    case "Quit":
    case "CloseWindow":
      window.close();
      setTimeout(() => (location.href = "/"), 100);
      break;
  }
}

const PREDEFINED_LABEL: Record<string, [string, string]> = {
  Cut: ["Couper", "CmdOrCtrl+X"],
  Copy: ["Copier", "CmdOrCtrl+C"],
  Paste: ["Coller", "CmdOrCtrl+V"],
  SelectAll: ["Tout sélectionner", "CmdOrCtrl+A"],
  Fullscreen: ["Plein écran", "F11"],
  Quit: ["Quitter", ""],
  CloseWindow: ["Fermer la fenêtre", ""],
};

function buildList(list: Entry[], close: () => void): HTMLDivElement {
  const box = document.createElement("div");
  box.className = "auxi-menu";
  box.setAttribute("role", "menu");
  let lastWasSep = true;
  for (const i of list) {
    if (i instanceof PredefinedMenuItem) {
      if (i.item === "Separator") {
        if (!lastWasSep) box.append(Object.assign(document.createElement("div"), { className: "auxi-menu-sep" }));
        lastWasSep = true;
        continue;
      }
      const known = PREDEFINED_LABEL[i.item];
      if (!known) continue;
      box.append(row(i.text ?? known[0], known[1], false, null, true, () => {
        close();
        runPredefined(i);
      }));
      lastWasSep = false;
      continue;
    }
    if (i instanceof Submenu) {
      const r = row(i.text, "", false, null, i.enabled, () => {});
      r.classList.add("has-sub");
      const sub = buildList(i.entries(), close);
      sub.classList.add("auxi-submenu");
      r.append(sub);
      // Placé par rapport à la fenêtre : un menu qui défile couperait un
      // sous-menu placé à côté de lui. À droite de la ligne, sinon à gauche ;
      // remonté s'il dépasse le bas de la fenêtre.
      r.addEventListener("mouseenter", () => {
        const row = r.getBoundingClientRect();
        sub.style.left = `${row.right - 2}px`;
        sub.style.top = `${row.top - 5}px`;
        requestAnimationFrame(() => {
          const s = sub.getBoundingClientRect();
          if (s.right > innerWidth - 4) sub.style.left = `${Math.max(4, row.left - s.width + 2)}px`;
          if (s.bottom > innerHeight - 4) sub.style.top = `${Math.max(4, innerHeight - s.height - 4)}px`;
        });
      });
      box.append(r);
      lastWasSep = false;
      continue;
    }
    const checked = i instanceof CheckMenuItem ? i.checked : null;
    box.append(row(i.text, i.accelerator ?? "", false, checked, i.enabled, () => {
      close();
      i.action?.(i.id);
    }));
    lastWasSep = false;
  }
  if (box.lastElementChild?.classList.contains("auxi-menu-sep")) box.lastElementChild.remove();
  return box;
}

/** Libellé sans marque de raccourci (« &Fichier » → « Fichier », « && » → « & »). */
function mnemonic(text: string): string {
  return text.replace(/&&|&/g, (m) => (m === "&&" ? "&" : ""));
}

function row(text: string, accel: string, _top: boolean, checked: boolean | null, enabled: boolean, onClick: () => void): HTMLDivElement {
  const r = document.createElement("div");
  r.className = `auxi-menu-item${enabled ? "" : " disabled"}`;
  r.setAttribute("role", checked === null ? "menuitem" : "menuitemcheckbox");
  const mark = document.createElement("span");
  mark.className = "check";
  mark.textContent = checked ? "✓" : "";
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = mnemonic(text);
  const acc = document.createElement("span");
  acc.className = "accel";
  acc.textContent = accelLabel(accel);
  r.append(mark, label, acc);
  if (enabled) r.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".auxi-submenu") && !r.classList.contains("has-sub")) return;
    if (r.classList.contains("has-sub")) return;
    e.stopPropagation();
    onClick();
  });
  return r;
}

function render() {
  const b = ensureBar();
  b.replaceChildren();
  if (!current) return;
  const close = () => {
    openIndex = -1;
    render();
  };
  const tops = current.entries().filter((e): e is Submenu => e instanceof Submenu);
  tops.forEach((sub, idx) => {
    const t = document.createElement("div");
    t.className = `auxi-menubar-top${idx === openIndex ? " open" : ""}`;
    t.textContent = mnemonic(sub.text);
    t.setAttribute("role", "menuitem");
    t.onclick = () => {
      openIndex = openIndex === idx ? -1 : idx;
      render();
    };
    t.onmouseenter = () => {
      if (openIndex >= 0 && openIndex !== idx) {
        openIndex = idx;
        render();
      }
    };
    if (idx === openIndex) t.append(buildList(sub.entries(), close));
    b.append(t);
  });
  const spacer = document.createElement("span");
  spacer.className = "spacer";
  const home = document.createElement("a");
  home.className = "auxi-menubar-home";
  home.href = "/";
  home.target = "_blank";
  home.title = "Portail d'AuxiOffice Online : applications et fichiers";
  home.textContent = "Mes fichiers";
  b.append(spacer, home);
}

let pending = false;
rerender = () => {
  if (pending) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    if (current) render();
  });
};
