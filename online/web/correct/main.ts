// AuxiCorrect dans AuxiOffice Online : écrire ou coller un texte, le voir
// corrigé (soulignements dans le texte, liste des remarques, suggestions à
// appliquer d'un clic) et consulter le dictionnaire (définition, synonymes,
// antonymes, conjugaison). La correction est faite par AuxiCorrect sur le
// serveur, avec les options du compte (Mon profil).

import { messageBox, pickFile, toast } from "../shared/dialogs";
import { baseName, files, type Remark } from "../shared/http";
import "../shared/online.css";
import "./correct.css";

type Child = Node | string | null | false | undefined;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === "className") e.className = String(v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== false && c !== undefined) e.append(c);
  return e;
}

const dark = matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", dark.matches);
applyTheme();
dark.addEventListener("change", applyTheme);

const DRAFT = "auxicorrect-brouillon";
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// --- Interface ------------------------------------------------------------------------

const editor = h("textarea", { className: "ac-text", spellcheck: "false", placeholder: "Écrivez ou collez votre texte ici. AuxiCorrect le vérifie pendant que vous tapez." }) as HTMLTextAreaElement;
const backdrop = h("div", { className: "ac-backdrop", "aria-hidden": "true" });
const status = h("span", { className: "ac-status" });
const count = h("span", { className: "ac-count" });
const remarksBox = h("div", { className: "ac-remarks" });
const word = h("input", { className: "auxi-input", placeholder: "Un mot" }) as HTMLInputElement;
const dictOut = h("div", { className: "ac-dict-out" });
let international = false;
let currentFile: string | null = null;

const tabs = { corr: h("button", { className: "active" }, "Corrections"), dict: h("button", {}, "Dictionnaire") };
const panels = { corr: remarksBox, dict: h("div", { className: "ac-dict" }) };
function showTab(t: "corr" | "dict") {
  for (const k of ["corr", "dict"] as const) {
    tabs[k].classList.toggle("active", k === t);
    panels[k].hidden = k !== t;
  }
}
tabs.corr.onclick = () => showTab("corr");
tabs.dict.onclick = () => showTab("dict");

const lookups: [string, string][] = [
  ["definir", "Définition"],
  ["synonymes", "Synonymes"],
  ["antonymes", "Antonymes"],
  ["conjuguer", "Conjugaison"],
];
async function lookup(what: string) {
  const w = word.value.trim();
  if (!w) return word.focus();
  dictOut.textContent = "Recherche…";
  try {
    const r = await files.lookup(what, w);
    dictOut.textContent = r.text.trim() || "Rien trouvé.";
  } catch (e) {
    dictOut.textContent = errText(e);
  }
}
panels.dict.append(
  h("div", { className: "ac-dict-row" }, word),
  h("div", { className: "ac-dict-buttons" }, ...lookups.map(([what, label]) => h("button", { className: "secondary", onclick: () => void lookup(what) }, label))),
  dictOut,
  h("p", { className: "muted small" }, "Astuce : un double-clic sur un mot du texte le cherche ici."),
);
word.addEventListener("keydown", (e) => e.key === "Enter" && void lookup("definir"));
panels.dict.hidden = true;

const intl = h("input", { type: "checkbox" }) as HTMLInputElement;
intl.onchange = () => {
  international = intl.checked;
  void files
    .auxicorrect()
    .then((ac) => files.setAuxicorrect({ ...ac.options, international }))
    .catch(() => undefined);
  void runCheck();
};

const header = h(
  "header",
  { className: "ac-bar" },
  h("img", { src: "/auxicorrect.svg", alt: "" }),
  h("span", { className: "ac-title" }, "AuxiCorrect"),
  h("span", { className: "ac-file" }),
  h("span", { className: "spacer" }),
  h("button", { className: "secondary", onclick: () => void openFile() }, "Ouvrir…"),
  h("button", { className: "secondary", onclick: () => void saveFile() }, "Enregistrer sous…"),
  h("button", { className: "secondary", onclick: () => void copyText() }, "Copier le texte"),
  h("label", { className: "auxi-check", title: "Profil de correction (sinon : français québécois)" }, intl, "Français international"),
  h("a", { className: "ac-link", href: "/#profil", target: "_blank" }, "Options"),
  h("a", { className: "ac-link strong", href: "/", target: "_blank" }, "Mes fichiers"),
);

document.getElementById("app")!.append(
  header,
  h(
    "div",
    { className: "ac-main" },
    h("div", { className: "ac-editor" }, h("div", { className: "ac-stack" }, backdrop, editor), h("div", { className: "ac-foot" }, status, h("span", { className: "spacer" }), count)),
    h("aside", { className: "ac-side" }, h("div", { className: "ac-tabs" }, tabs.corr, tabs.dict), remarksBox, panels.dict),
  ),
);

// --- Correction -------------------------------------------------------------------------

let remarks: Remark[] = [];
/** Texte vérifié : les positions des remarques ne valent que pour lui. */
let checkedText = "";
let timer = 0;
let seq = 0;

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function kindOf(r: Remark): string {
  const c = r.category.toLowerCase();
  if (c.includes("typo") || c.includes("ponct")) return "typo";
  if (c.includes("style") || r.severity.toLowerCase() === "hint") return "style";
  if (c.includes("orth") || c.includes("spell")) return "spell";
  return "grammar";
}

/** Fond sous la zone de saisie : le même texte, fautes soulignées. */
function paint() {
  const text = editor.value;
  if (text !== checkedText) {
    backdrop.innerHTML = escapeHtml(text) + "\n";
    return;
  }
  let html = "";
  let at = 0;
  for (const [i, r] of remarks.entries()) {
    if (r.from < at) continue;
    html += escapeHtml(text.slice(at, r.from)) + `<mark class="${kindOf(r)}" data-i="${i}">${escapeHtml(text.slice(r.from, r.to))}</mark>`;
    at = r.to;
  }
  backdrop.innerHTML = html + escapeHtml(text.slice(at)) + "\n";
  syncScroll();
}

function syncScroll() {
  backdrop.scrollTop = editor.scrollTop;
  backdrop.scrollLeft = editor.scrollLeft;
}

function renderRemarks(active = -1) {
  remarksBox.replaceChildren();
  if (!editor.value.trim()) {
    remarksBox.append(h("p", { className: "muted" }, "Les remarques d'AuxiCorrect apparaîtront ici."));
    return;
  }
  if (!remarks.length) {
    remarksBox.append(h("p", { className: "ac-ok" }, "✓ Aucune faute trouvée."));
    return;
  }
  for (const [i, r] of remarks.entries()) {
    const item = h(
      "div",
      { className: `ac-remark ${kindOf(r)}${i === active ? " active" : ""}`, "data-i": String(i) },
      h("div", { className: "ac-excerpt" }, checkedText.slice(r.from, r.to) || "(espace)"),
      h("div", { className: "ac-message" }, r.message),
      r.suggestions.length > 0 && h("div", { className: "ac-sugg" }, ...r.suggestions.slice(0, 6).map((s) => h("button", { onclick: () => apply(r, s) }, s || "(supprimer)"))),
    );
    item.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).tagName === "BUTTON") return;
      editor.focus();
      editor.setSelectionRange(r.from, r.to);
    });
    remarksBox.append(item);
  }
  remarksBox.querySelector(".active")?.scrollIntoView({ block: "nearest" });
}

function apply(r: Remark, s: string) {
  if (editor.value !== checkedText) return void runCheck();
  editor.focus();
  editor.setSelectionRange(r.from, r.to);
  // Annulable par Ctrl+Z, comme une frappe.
  if (!document.execCommand("insertText", false, s)) {
    editor.setRangeText(s, r.from, r.to, "end");
    editor.dispatchEvent(new Event("input"));
  }
}

async function runCheck() {
  const text = editor.value;
  const my = ++seq;
  if (!text.trim()) {
    remarks = [];
    checkedText = text;
    status.textContent = "";
    paint();
    renderRemarks();
    return;
  }
  status.textContent = "Vérification…";
  try {
    const r = await files.check(text, international);
    if (my !== seq) return;
    remarks = r.sort((a, b) => a.from - b.from);
    checkedText = text;
    status.textContent = remarks.length ? `${remarks.length} remarque${remarks.length > 1 ? "s" : ""}` : "Aucune faute";
  } catch (e) {
    if (my !== seq) return;
    remarks = [];
    checkedText = "";
    status.textContent = errText(e);
  }
  paint();
  renderRemarks();
}

function updateCount() {
  const t = editor.value;
  const words = (t.match(/[\p{L}\p{N}’'-]+/gu) ?? []).length;
  count.textContent = `${words} mot${words > 1 ? "s" : ""}, ${t.length} caractère${t.length > 1 ? "s" : ""}`;
}

editor.addEventListener("input", () => {
  localStorage.setItem(DRAFT, editor.value);
  updateCount();
  paint();
  clearTimeout(timer);
  timer = window.setTimeout(() => void runCheck(), 700);
});
editor.addEventListener("scroll", syncScroll);
// Curseur dans une faute : sa remarque est mise en évidence.
const follow = () => {
  if (editor.value !== checkedText) return;
  const p = editor.selectionStart;
  const i = remarks.findIndex((r) => p >= r.from && p <= r.to);
  if (i >= 0) {
    showTab("corr");
    renderRemarks(i);
  }
};
editor.addEventListener("click", follow);
editor.addEventListener("keyup", (e) => e.key.startsWith("Arrow") && follow());
editor.addEventListener("dblclick", () => {
  const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd).trim();
  if (sel && sel.length < 60 && !/\s/.test(sel)) {
    word.value = sel.replace(/[.,;:!?«»"()]+/g, "");
    showTab("dict");
    void lookup("definir");
  }
});

// --- Fichiers -----------------------------------------------------------------------------

function setFile(p: string | null) {
  currentFile = p;
  header.querySelector(".ac-file")!.textContent = p ? baseName(p) : "";
  document.title = p ? `${baseName(p)} — AuxiCorrect` : "AuxiCorrect";
}

async function openFile() {
  const p = (await pickFile({ mode: "open", filters: [{ name: "Textes", extensions: ["txt", "md", "markdown", "text"] }] })) as string | null;
  if (!p) return;
  try {
    const bytes = await files.read(p);
    editor.value = new TextDecoder("utf-8").decode(bytes);
    setFile(p);
    editor.dispatchEvent(new Event("input"));
  } catch (e) {
    await messageBox(`Impossible d'ouvrir « ${baseName(p)} ».\n\n${errText(e)}`, { title: "AuxiCorrect", kind: "error" });
  }
}

async function saveFile() {
  const p = (await pickFile({ mode: "save", filters: [{ name: "Texte", extensions: ["txt"] }, { name: "Markdown", extensions: ["md"] }], defaultPath: currentFile ?? "Texte corrigé.txt" })) as string | null;
  if (!p) return;
  try {
    await files.write(p, new Blob([editor.value], { type: "text/plain;charset=utf-8" }));
    setFile(p);
    toast("Texte enregistré.", 2000);
  } catch (e) {
    await messageBox(`L'enregistrement a échoué.\n\n${errText(e)}`, { title: "AuxiCorrect", kind: "error" });
  }
}

async function copyText() {
  try {
    await navigator.clipboard.writeText(editor.value);
    toast("Texte copié.", 1500);
  } catch {
    editor.select();
    document.execCommand("copy");
  }
}

// --- Démarrage -----------------------------------------------------------------------------

void (async () => {
  try {
    const ac = await files.auxicorrect();
    if (!ac.available) {
      status.textContent = "AuxiCorrect n'est pas installé sur ce serveur.";
      editor.disabled = true;
      return;
    }
    international = ac.options.international;
    intl.checked = international;
  } catch (e) {
    status.textContent = errText(e);
  }
  const params = new URLSearchParams(location.search);
  const open = params.get("open");
  if (open) {
    try {
      editor.value = new TextDecoder("utf-8").decode(await files.read(open));
      setFile(open);
    } catch (e) {
      toast(errText(e), 6000);
    }
    history.replaceState(null, "", location.pathname);
  } else {
    editor.value = localStorage.getItem(DRAFT) ?? "";
  }
  updateCount();
  paint();
  renderRemarks();
  if (editor.value.trim()) void runCheck();
  editor.focus();
})();
