// Portail d'AuxiOffice Online : connexion, création de documents,
// applications et « Mes fichiers » (envoi, téléchargement, renommage…).
// Page légère, sans cadriciel : elle s'affiche avant tout le reste.

import { APPS, appFor, appUrl, isLiteSheet, launch, type AppId } from "../shared/apps";
import { form, messageBox, prompt, toast } from "../shared/dialogs";
import { fileIcon } from "../shared/icons";
import { baseName, dirName, files, formatSize, joinPath, upload, type Account, type Entry, type Me } from "../shared/http";
import "../shared/online.css";
import "./portal.css";

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

const root = document.getElementById("portal")!;
const dark = matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", dark.matches);
applyTheme();
dark.addEventListener("change", applyTheme);

const dateFmt = new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium", timeStyle: "short" });

function logo() {
  return h("div", { className: "brand" }, h("img", { src: dark.matches ? "/logo-dark.svg" : "/logo-light.svg", alt: "AuxiOffice" }), h("span", { className: "badge" }, "Online"));
}

// --- Connexion ---------------------------------------------------------------------

function showLogin(error = "") {
  const email = h("input", { type: "email", className: "auxi-input", autocomplete: "username", required: true, placeholder: "vous@exemple.ca" }) as HTMLInputElement;
  const password = h("input", { type: "password", className: "auxi-input", autocomplete: "current-password", required: true }) as HTMLInputElement;
  const msg = h("div", { className: "login-error" }, error);
  const submit = h("button", { className: "primary", type: "submit" }, "Se connecter");
  const form = h(
    "form",
    {
      className: "login",
      onsubmit: async (e: Event) => {
        e.preventDefault();
        submit.setAttribute("disabled", "");
        msg.textContent = "";
        try {
          await files.login(email.value, password.value);
          const back = new URLSearchParams(location.search).get("retour");
          if (back && back.startsWith("/") && !back.startsWith("//")) location.href = back;
          else void start();
        } catch (err) {
          msg.textContent = err instanceof Error ? err.message : String(err);
          submit.removeAttribute("disabled");
          password.select();
        }
      },
    },
    logo(),
    h("p", { className: "muted" }, "Votre suite bureautique, dans votre navigateur."),
    h("label", {}, "Courriel", email),
    h("label", {}, "Mot de passe", password),
    msg,
    submit,
  );
  root.replaceChildren(h("div", { className: "login-page" }, form, footer()));
  email.focus();
}

function footer() {
  return h("footer", { className: "foot" }, "AuxiOffice Online — ", h("a", { href: "https://office.auxinux.ca", target: "_blank", rel: "noopener" }, "office.auxinux.ca"));
}

// --- Tableau de bord ----------------------------------------------------------------

let me: Me;
let cwd = sessionStorage.getItem("auxi-portail-dossier") ?? "/Documents";

const CREATE: { app: AppId; label: string; icon: string }[] = [
  { app: "writer", label: "Document texte", icon: "/icons/mime-document.svg" },
  { app: "sheet", label: "Classeur", icon: "/icons/mime-spreadsheet.svg" },
  { app: "sheetlite", label: "Classeur Lite", icon: "/icons/auxisheet.svg" },
  { app: "present", label: "Présentation", icon: "/icons/mime-presentation.svg" },
  { app: "draw", label: "Dessin", icon: "/icons/mime-drawing.svg" },
  { app: "text", label: "Fichier texte", icon: "/auxitext.svg" },
];


async function showDashboard() {
  const user = me.user!;
  const usage = me.usage;
  const pct = usage ? Math.min(100, Math.round((usage.used / Math.max(1, usage.quota)) * 100)) : 0;
  const header = h(
    "header",
    { className: "top" },
    logo(),
    h("span", { className: "spacer" }),
    usage && h("span", { className: "usage", title: `${formatSize(usage.used)} sur ${formatSize(usage.quota)}` }, h("span", { className: "bar" }, h("span", { style: `width:${pct}%` })), `${formatSize(usage.used)} / ${formatSize(usage.quota)}`),
    h("span", { className: "user" }, user.name || user.email),
    me.auth && h("button", { className: "secondary", onclick: () => void changePassword() }, "Mon mot de passe"),
    me.auth &&
      h(
        "button",
        {
          className: "secondary",
          onclick: async () => {
            await files.logout().catch(() => undefined);
            showLogin();
          },
        },
        "Déconnexion",
      ),
  );

  const create = h(
    "section",
    { className: "create" },
    h("h2", {}, "Créer"),
    h("div", { className: "tiles" }, ...CREATE.map((c) => h("button", { className: "tile", onclick: () => launch(c.app, [], true) }, h("img", { src: c.icon, alt: "" }), h("span", {}, c.label)))),
  );

  const apps = h(
    "section",
    { className: "apps" },
    h("h2", {}, "Applications"),
    h(
      "div",
      { className: "tiles" },
      ...APPS.map((a) => h("a", { className: "tile app", href: appUrl(a.id), target: "_blank" }, h("img", { src: a.icon, alt: "" }), h("span", { className: "name" }, a.name), h("span", { className: "blurb" }, a.blurb))),
    ),
  );

  const browser = h("section", { className: "browser" });
  const adminBox = user.admin ? h("section", { className: "browser admin" }) : null;
  root.replaceChildren(h("div", { className: "page" }, header, h("main", {}, create, apps, browser, adminBox), footer()));
  await renderFiles(browser);
  if (adminBox) await renderAdmin(adminBox);
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function changePassword() {
  const done = await form(
    "Changer mon mot de passe",
    [
      { name: "old", label: "Mot de passe actuel", type: "password" },
      { name: "new", label: "Nouveau mot de passe (8 caractères au moins)", type: "password" },
      { name: "again", label: "Nouveau mot de passe, encore", type: "password" },
    ],
    "Changer",
    async (v) => {
      if (v.new !== v.again) return "Les deux nouveaux mots de passe diffèrent.";
      try {
        await files.changePassword(String(v.old), String(v.new));
        return null;
      } catch (e) {
        return errText(e);
      }
    },
  );
  if (done) toast("Mot de passe changé. Vos autres sessions ont été fermées.");
}

// --- Administration des comptes ---------------------------------------------------

async function renderAdmin(box: HTMLElement) {
  let list: Account[] = [];
  let defaultQuota = 0;
  try {
    const r = await files.adminUsers();
    list = r.users;
    defaultQuota = r.default_quota_mb;
  } catch (e) {
    box.replaceChildren(h("h2", {}, "Administration"), h("p", { className: "hint" }, errText(e)));
    return;
  }
  const refresh = () => void renderAdmin(box);
  const quotaLabel = (a: Account) => `${formatSize(a.used)} / ${formatSize(a.quota_mb * 1024 * 1024)}${a.custom_quota ? "" : " (défaut)"}`;

  const add = async () => {
    const v = await form(
      "Nouveau compte",
      [
        { name: "email", label: "Courriel", type: "email" },
        { name: "name", label: "Nom affiché" },
        { name: "password", label: "Mot de passe initial (8 caractères au moins)", type: "password" },
        { name: "quota", label: `Espace en Mo (vide : ${defaultQuota} Mo par défaut)`, type: "number" },
        { name: "admin", label: "Administrateur (gère les comptes)", type: "checkbox" },
      ],
      "Créer le compte",
      async (v) => {
        try {
          const q = Number(v.quota);
          await files.adminAdd({ email: String(v.email), name: String(v.name), password: String(v.password), admin: !!v.admin, quota_mb: q > 0 ? q : undefined });
          return null;
        } catch (e) {
          return errText(e);
        }
      },
    );
    if (v) {
      toast(`Compte ${v.email} créé.`);
      refresh();
    }
  };

  const edit = async (a: Account) => {
    const v = await form(
      `Modifier ${a.email}`,
      [
        { name: "name", label: "Nom affiché", value: a.name },
        { name: "password", label: "Nouveau mot de passe (vide : inchangé ; ses sessions seront fermées)", type: "password" },
        { name: "quota", label: `Espace en Mo (vide ou 0 : ${defaultQuota} Mo par défaut)`, type: "number", value: a.custom_quota ? String(a.quota_mb) : "" },
        { name: "admin", label: "Administrateur", type: "checkbox", value: a.admin },
      ],
      "Enregistrer",
      async (v) => {
        try {
          await files.adminUpdate({ email: a.email, name: String(v.name), password: String(v.password) || undefined, admin: !!v.admin, quota_mb: Number(v.quota) || 0 });
          return null;
        } catch (e) {
          return errText(e);
        }
      },
    );
    if (v) refresh();
  };

  const remove = async (a: Account) => {
    const choice = await messageBox(`Supprimer le compte ${a.email} ?\n\nSes fichiers (${formatSize(a.used)}) peuvent être gardés sur le serveur ou supprimés aussi.`, {
      title: "Supprimer un compte",
      kind: "warning",
      buttons: ["Supprimer le compte", "Supprimer aussi ses fichiers", "Annuler"],
    });
    if (choice !== "Supprimer le compte" && choice !== "Supprimer aussi ses fichiers") return;
    try {
      await files.adminDelete(a.email, choice === "Supprimer aussi ses fichiers");
      toast(`Compte ${a.email} supprimé.`);
    } catch (e) {
      await messageBox(errText(e), { title: "Supprimer un compte", kind: "error" });
    }
    refresh();
  };

  box.replaceChildren(
    h("div", { className: "browser-head" }, h("h2", {}, "Administration : comptes"), h("span", { className: "spacer" }), h("button", { className: "primary", onclick: () => void add() }, "Nouveau compte…")),
    h(
      "div",
      { className: "file-list accounts" },
      ...list.map((a) =>
        h(
          "div",
          { className: "frow account" },
          h("span", { className: "name" }, a.name, h("span", { className: "mail" }, ` ${a.email}`)),
          h("span", { className: "role" }, a.admin ? "administrateur" : ""),
          h("span", { className: "size" }, quotaLabel(a)),
          h(
            "span",
            { className: "row-actions" },
            h("button", { className: "act", title: "Modifier (nom, mot de passe, espace, rôle)", onclick: () => void edit(a) }, "✎"),
            a.email !== me.user?.email && h("button", { className: "act danger", title: "Supprimer le compte", onclick: () => void remove(a) }, "🗑"),
          ),
        ),
      ),
    ),
    h("p", { className: "hint" }, "Chaque compte a son espace « Mes fichiers ». Un nouveau mot de passe ferme les sessions ouvertes du compte."),
  );
}

async function renderFiles(box: HTMLElement) {
  let entries: Entry[] = [];
  try {
    const r = await files.list(cwd);
    cwd = r.path;
    entries = r.entries;
  } catch {
    if (cwd !== "/") {
      cwd = "/";
      return renderFiles(box);
    }
  }
  sessionStorage.setItem("auxi-portail-dossier", cwd);
  const refresh = () => void renderFiles(box);
  const go = (p: string) => {
    cwd = p;
    refresh();
  };
  const input = h("input", { type: "file", multiple: true, hidden: true }) as HTMLInputElement;
  const send = async (list: FileList | File[]) => {
    if (!list.length) return;
    toast(list.length > 1 ? `Envoi de ${list.length} fichiers…` : `Envoi de « ${list[0].name} »…`, 2000);
    try {
      await upload(cwd, list);
    } catch (e) {
      await messageBox(`Envoi impossible.\n\n${e instanceof Error ? e.message : e}`, { title: "Mes fichiers", kind: "error" });
    }
    refresh();
  };
  input.onchange = () => void send(input.files ?? []);

  const parts = cwd.split("/").filter(Boolean);
  const crumbs = h(
    "div",
    { className: "auxi-crumbs" },
    h("button", { className: "crumb", onclick: () => go("/") }, "Mes fichiers"),
    ...parts.flatMap((p, i) => [h("span", { className: "sep" }, "›"), h("button", { className: "crumb", onclick: () => go("/" + parts.slice(0, i + 1).join("/")) }, p)]),
  );

  const open = (e: Entry) => {
    const p = joinPath(cwd, e.name);
    if (e.dir) return go(p);
    launch(appFor(p), [p]);
  };

  const actions = (e: Entry) => {
    const p = joinPath(cwd, e.name);
    return h(
      "span",
      { className: "row-actions" },
      !e.dir &&
        isLiteSheet(p) &&
        h(
          "button",
          { className: "act lite", title: "Ouvrir dans AuxiSheet Lite : calculé dans votre navigateur, sans moteur sur le serveur", onclick: (ev: Event) => (ev.stopPropagation(), launch("sheetlite", [p])) },
          "Lite",
        ),
      !e.dir && h("a", { className: "act", href: files.url(p, true), title: "Télécharger sur cet ordinateur", onclick: (ev: Event) => ev.stopPropagation() }, "⬇"),
      h(
        "button",
        {
          className: "act",
          title: "Renommer",
          onclick: async (ev: Event) => {
            ev.stopPropagation();
            const name = await prompt("Renommer", "Nouveau nom", e.name);
            if (!name || name === e.name) return;
            try {
              await files.move(p, joinPath(cwd, name));
            } catch (err) {
              await messageBox(String(err instanceof Error ? err.message : err), { title: "Renommer", kind: "error" });
            }
            refresh();
          },
        },
        "✎",
      ),
      h(
        "button",
        {
          className: "act danger",
          title: "Supprimer",
          onclick: async (ev: Event) => {
            ev.stopPropagation();
            const what = e.dir ? `le dossier « ${e.name} » et tout son contenu` : `« ${e.name} »`;
            if ((await messageBox(`Supprimer ${what} ? Cette action est définitive.`, { title: "Supprimer", kind: "warning", buttons: ["Supprimer", "Annuler"] })) !== "Supprimer") return;
            try {
              await files.remove(p);
            } catch (err) {
              await messageBox(String(err instanceof Error ? err.message : err), { title: "Supprimer", kind: "error" });
            }
            refresh();
          },
        },
        "🗑",
      ),
    );
  };

  const list = h(
    "div",
    { className: "file-list" },
    cwd !== "/" && h("div", { className: "frow up", ondblclick: () => go(dirName(cwd)), onclick: () => go(dirName(cwd)) }, h("span", { className: "ico" }, "↩"), h("span", { className: "name" }, "Dossier parent"), h("span", {}), h("span", {}), h("span", {})),
    ...entries.map((e) =>
      h(
        "div",
        { className: `frow${e.dir ? " dir" : ""}`, onclick: () => open(e), title: e.dir ? "Ouvrir le dossier" : `Ouvrir dans ${APPS.find((a) => a.id === appFor(e.name))?.name}` },
        fileIcon(e.name, e.dir),
        h("span", { className: "name" }, e.name),
        h("span", { className: "size" }, e.dir ? "" : formatSize(e.size)),
        h("span", { className: "date" }, e.mtime ? dateFmt.format(e.mtime) : ""),
        actions(e),
      ),
    ),
    !entries.length && h("div", { className: "empty" }, "Ce dossier est vide. Glissez des fichiers ici pour les envoyer."),
  );
  list.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types.includes("Files")) {
      e.preventDefault();
      list.classList.add("drop");
    }
  });
  list.addEventListener("dragleave", () => list.classList.remove("drop"));
  list.addEventListener("drop", (e) => {
    e.preventDefault();
    list.classList.remove("drop");
    if (e.dataTransfer?.files.length) void send(e.dataTransfer.files);
  });

  box.replaceChildren(
    h(
      "div",
      { className: "browser-head" },
      h("h2", {}, "Mes fichiers"),
      crumbs,
      h("span", { className: "spacer" }),
      h(
        "button",
        {
          className: "secondary",
          onclick: async () => {
            const name = await prompt("Nouveau dossier", "Nom du dossier");
            if (!name) return;
            try {
              await files.mkdir(joinPath(cwd, name));
            } catch (err) {
              await messageBox(String(err instanceof Error ? err.message : err), { title: "Nouveau dossier", kind: "error" });
            }
            refresh();
          },
        },
        "Nouveau dossier",
      ),
      h("button", { className: "primary", onclick: () => input.click() }, "Téléverser…"),
      input,
    ),
    list,
    h("p", { className: "hint" }, "Les documents de bureautique s'ouvrent dans leur application ; AuxiText et AuxiPDF travaillent entièrement dans votre navigateur. ", baseName(cwd) === "Documents" ? "Les fichiers glissés sur une application sont rangés ici." : ""),
  );
}

async function start() {
  me = await files.me().catch(() => ({ auth: true, version: "" }) as Me);
  if (!me.user) return showLogin();
  await showDashboard();
}

void start();
