// Portail d'AuxiOffice Online : connexion, création de documents,
// applications et « Mes fichiers » (envoi, téléchargement, renommage…).
// Page légère, sans cadriciel : elle s'affiche avant tout le reste.

import { APPS, appFor, appUrl, isLiteSheet, launch, PORTAL_APPS, type AppId } from "../shared/apps";
import { form, messageBox, prompt, toast } from "../shared/dialogs";
import { fileIcon } from "../shared/icons";
import { baseName, dirName, files, formatSize, joinPath, upload, type Account, type AcOptions, type Entry, type Me, type Plan, type Settings } from "../shared/http";
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
  { app: "present", label: "Présentation", icon: "/icons/mime-presentation.svg" },
  { app: "draw", label: "Dessin", icon: "/icons/mime-drawing.svg" },
  { app: "text", label: "Fichier texte", icon: "/auxitext.svg" },
];


/** Vue du portail d'après l'adresse : « #profil », « #admin », « #admin/reglages »… */
function view(): string {
  return location.hash.replace(/^#\/?/, "");
}
window.addEventListener("hashchange", () => void showDashboard());

function initials(name: string): string {
  return (
    name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  );
}

/** Menu du compte : profil, administration, déconnexion. */
function userMenu(): HTMLElement {
  const user = me.user!;
  const panel = h(
    "div",
    { className: "user-menu", role: "menu" },
    h("div", { className: "user-menu-head" }, h("strong", {}, user.name || user.email), h("span", { className: "muted" }, user.email)),
    h("a", { href: "#profil", role: "menuitem" }, "Mon profil"),
    user.admin && h("a", { href: "#admin", role: "menuitem" }, "Administration"),
    h("div", { className: "sep" }),
    h(
      "button",
      {
        role: "menuitem",
        onclick: async () => {
          await files.logout().catch(() => undefined);
          location.hash = "";
          showLogin();
        },
      },
      "Déconnexion",
    ),
  );
  const btn = h("button", { className: "user-btn", "aria-haspopup": "menu", title: "Mon compte" }, h("span", { className: "avatar" }, initials(user.name || user.email)), h("span", { className: "user-name" }, user.name || user.email), h("span", { className: "caret" }, "▾"));
  const wrap = h("div", { className: "user-wrap" }, btn, panel);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    wrap.classList.toggle("open");
  });
  document.addEventListener("click", () => wrap.classList.remove("open"));
  panel.addEventListener("click", () => wrap.classList.remove("open"));
  return wrap;
}

async function showDashboard() {
  me = await files.me().catch(() => me);
  if (!me.user) return showLogin();
  const usage = me.usage;
  const pct = usage ? Math.min(100, Math.round((usage.used / Math.max(1, usage.quota)) * 100)) : 0;
  const v = view();
  const header = h(
    "header",
    { className: "top" },
    h("a", { href: "#", className: "home-link" }, logo()),
    h("span", { className: "spacer" }),
    usage && h("span", { className: "usage", title: `Forfait ${usage.plan.name} : ${formatSize(usage.used)} sur ${formatSize(usage.quota)} (documents ${formatSize(usage.files)}, courriel ${formatSize(usage.mail)})` }, h("span", { className: "bar" }, h("span", { style: `width:${pct}%` })), `${formatSize(usage.used)} / ${formatSize(usage.quota)}`),
    me.auth ? userMenu() : h("span", { className: "user" }, me.user.name),
  );
  const main = h("main", {});
  root.replaceChildren(h("div", { className: "page" }, header, main, footer()));
  if (v === "profil" && me.auth) return renderProfile(main);
  if (v.startsWith("admin") && me.user.admin) return renderAdminPage(main, v.split("/")[1] ?? "comptes");
  await renderHome(main);
}

async function renderHome(main: HTMLElement) {
  const create = h(
    "section",
    { className: "create" },
    h("h2", {}, "Créer"),
    h("div", { className: "tiles" }, ...CREATE.map((c) => h("button", { className: "tile", onclick: () => launch(c.app, [], true) }, h("img", { src: c.icon, alt: "" }), h("span", {}, c.label)))),
  );
  const tile = (id: AppId) => {
    const a = APPS.find((x) => x.id === id)!;
    if (id === "mail") {
      const url = me.auximail ?? "";
      return url
        ? h("a", { className: "tile app", href: url, target: "_blank", rel: "noopener" }, h("img", { src: a.icon, alt: "" }), h("span", { className: "name" }, a.name), h("span", { className: "blurb" }, a.blurb))
        : h("div", { className: "tile app soon", title: "AuxiMail n'est pas encore offert sur ce serveur." }, h("img", { src: a.icon, alt: "" }), h("span", { className: "name" }, a.name), h("span", { className: "blurb" }, "Bientôt"));
    }
    if (id === "correct" && me.auxicorrect === false) {
      return h("div", { className: "tile app soon", title: "AuxiCorrect n'est pas installé sur ce serveur." }, h("img", { src: a.icon, alt: "" }), h("span", { className: "name" }, a.name), h("span", { className: "blurb" }, "Non installé"));
    }
    return h("a", { className: "tile app", href: appUrl(id), target: "_blank" }, h("img", { src: a.icon, alt: "" }), h("span", { className: "name" }, a.name), h("span", { className: "blurb" }, a.blurb));
  };
  const apps = h("section", { className: "apps" }, h("h2", {}, "Applications"), h("div", { className: "tiles" }, ...PORTAL_APPS.map(tile)));
  const browser = h("section", { className: "browser" });
  main.replaceChildren(create, apps, browser);
  await renderFiles(browser);
}

// --- Mon profil -------------------------------------------------------------------

async function renderProfile(main: HTMLElement) {
  const user = me.user!;
  const usage = me.usage;
  const name = h("input", { className: "auxi-input", value: user.name }) as HTMLInputElement;
  const saveName = h("button", { className: "primary", onclick: async () => {
    try {
      await files.setProfile(name.value);
      toast("Nom enregistré.");
      void showDashboard();
    } catch (e) {
      toast(errText(e), 6000);
    }
  } }, "Enregistrer");
  const pw = { old: h("input", { type: "password", className: "auxi-input", autocomplete: "current-password" }) as HTMLInputElement, next: h("input", { type: "password", className: "auxi-input", autocomplete: "new-password" }) as HTMLInputElement, again: h("input", { type: "password", className: "auxi-input", autocomplete: "new-password" }) as HTMLInputElement };
  const pwMsg = h("div", { className: "form-msg" });
  const changePw = h("button", { className: "primary", onclick: async () => {
    pwMsg.textContent = "";
    if (pw.next.value !== pw.again.value) return void (pwMsg.textContent = "Les deux nouveaux mots de passe diffèrent.");
    try {
      await files.changePassword(pw.old.value, pw.next.value);
      pw.old.value = pw.next.value = pw.again.value = "";
      toast("Mot de passe changé. Vos autres sessions ont été fermées.");
    } catch (e) {
      pwMsg.textContent = errText(e);
    }
  } }, "Changer le mot de passe");
  const card = (title: string, ...body: (Node | string | false | null)[]) => h("section", { className: "card" }, h("h2", {}, title), ...body);
  const field = (label: string, input: HTMLElement) => h("label", { className: "form-field" }, h("span", {}, label), input);
  const pct = usage ? Math.min(100, Math.round((usage.used / Math.max(1, usage.quota)) * 100)) : 0;

  const acBox = card("AuxiCorrect", h("p", { className: "muted" }, "Chargement…"));
  main.replaceChildren(
    h("div", { className: "page-title" }, h("a", { href: "#" }, "← Accueil"), h("h1", {}, "Mon profil")),
    h(
      "div",
      { className: "cards" },
      card("Identité", field("Nom affiché", name), field("Courriel", h("input", { className: "auxi-input", value: user.email, disabled: true })), h("div", { className: "form-actions" }, saveName)),
      card(
        "Espace de stockage",
        usage
          ? h(
              "div",
              { className: "big-usage" },
              h("strong", {}, `Forfait ${usage.plan.name} : ${formatSize(usage.quota)}`),
              h("span", { className: "bar" }, h("span", { className: "files", style: `width:${Math.min(100, (usage.files / Math.max(1, usage.quota)) * 100)}%` }), h("span", { className: "mail", style: `width:${Math.min(100, (usage.mail / Math.max(1, usage.quota)) * 100)}%` })),
              h("span", {}, `${formatSize(usage.used)} utilisés (${pct} %), ${formatSize(usage.available)} libres`),
              h("span", { className: "legend" }, h("span", {}, h("i", { className: "files" }), `Documents ${formatSize(usage.files)}`), h("span", {}, h("i", { className: "mail" }), `Courriel et pièces jointes ${formatSize(usage.mail)}`)),
            )
          : "",
        h("p", { className: "muted" }, "Tout ce qui est gardé à votre nom compte dans le forfait. Pour plus d'espace, adressez-vous à l'administrateur."),
      ),
      card("Mot de passe", field("Mot de passe actuel", pw.old), field("Nouveau mot de passe (8 caractères au moins)", pw.next), field("Nouveau mot de passe, encore", pw.again), pwMsg, h("div", { className: "form-actions" }, changePw)),
      acBox,
    ),
  );
  name.addEventListener("keydown", (e) => e.key === "Enter" && saveName.click());

  // Options d'AuxiCorrect du compte (AuxiWriter, AuxiText, AuxiCorrect).
  try {
    const ac = await files.auxicorrect();
    if (!ac.available) {
      acBox.replaceChildren(h("h2", {}, "AuxiCorrect"), h("p", { className: "muted" }, "AuxiCorrect n'est pas installé sur ce serveur : la correction est faite par le correcteur intégré."));
      return;
    }
    const o: AcOptions = { ...ac.options };
    const save = async () => {
      try {
        await files.setAuxicorrect(o);
        toast("Options d'AuxiCorrect enregistrées.", 2000);
      } catch (e) {
        toast(errText(e), 6000);
      }
    };
    const check = (label: string, key: "enabled" | "international" | "style" | "regional") => {
      const c = h("input", { type: "checkbox" }) as HTMLInputElement;
      c.checked = o[key];
      c.onchange = () => {
        o[key] = c.checked;
        void save();
      };
      return h("label", { className: "auxi-check" }, c, label);
    };
    const variant = h("select", { className: "auxi-input" }, ...[["toutes", "Toutes les graphies"], ["classique", "Orthographe classique"], ["1990", "Orthographe rectifiée (1990)"]].map(([v, l]) => h("option", { value: v }, l))) as HTMLSelectElement;
    variant.value = o.variant;
    variant.onchange = () => {
      o.variant = variant.value;
      void save();
    };
    acBox.replaceChildren(
      h("h2", {}, `AuxiCorrect ${ac.version ?? ""}`),
      check("Corriger le français avec AuxiCorrect (au lieu du correcteur intégré)", "enabled"),
      check("Français international (sinon : québécois)", "international"),
      check("Signaler les particularités régionales (québécismes, anglicismes…)", "regional"),
      check("Suggestions de style", "style"),
      field("Variante orthographique", variant),
      h("p", { className: "muted" }, "Ces options valent dans AuxiWriter, AuxiText et AuxiCorrect, aussitôt."),
    );
  } catch (e) {
    acBox.replaceChildren(h("h2", {}, "AuxiCorrect"), h("p", { className: "muted" }, errText(e)));
  }
}

// --- Administration ---------------------------------------------------------------

async function renderAdminPage(main: HTMLElement, tab: string) {
  const tabs: [string, string][] = [
    ["comptes", "Comptes"],
    ["reglages", "Réglages"],
    ["serveur", "Serveur"],
  ];
  const body = h("section", { className: "card wide" });
  main.replaceChildren(
    h("div", { className: "page-title" }, h("a", { href: "#" }, "← Accueil"), h("h1", {}, "Administration")),
    h("nav", { className: "tabs" }, ...tabs.map(([id, label]) => h("a", { href: `#admin/${id}`, className: tab === id ? "active" : "" }, label))),
    body,
  );
  if (tab === "reglages") return renderSettings(body);
  if (tab === "serveur") return renderStatus(body);
  return renderAdmin(body);
}

async function renderSettings(box: HTMLElement) {
  let st: Settings;
  try {
    st = await files.settings();
  } catch (e) {
    box.replaceChildren(h("p", {}, errText(e)));
    return;
  }
  const num = (v: number) => h("input", { type: "number", className: "auxi-input", value: String(v), min: "1" }) as HTMLInputElement;
  const docs = num(st.max_docs_per_user);
  const idle = num(st.idle_minutes);
  const mail = h("input", { type: "text", className: "auxi-input", value: st.auximail_url, placeholder: "/mail/" }) as HTMLInputElement;
  const msg = h("div", { className: "form-msg" });
  const field = (label: string, input: HTMLElement, hint: string) => h("label", { className: "form-field" }, h("span", {}, label), input, h("small", { className: "muted" }, hint));

  // Forfaits : nom, espace (Mo), forfait par défaut.
  let plans: Plan[] = st.plans.map((p) => ({ ...p }));
  let defaultPlan = st.default_plan;
  const plansBox = h("div", { className: "plans" });
  const renderPlans = () => {
    plansBox.replaceChildren(
      h("div", { className: "plan-row head" }, h("span", {}, "Nom"), h("span", {}, "Espace (Mo)"), h("span", {}, "Par défaut"), h("span", {})),
      ...plans.map((p, i) => {
        const name = h("input", { className: "auxi-input", value: p.name }) as HTMLInputElement;
        name.oninput = () => (p.name = name.value);
        const quota = h("input", { type: "number", className: "auxi-input", value: String(p.quota_mb), min: "10" }) as HTMLInputElement;
        const size = h("small", { className: "muted" }, formatSize(p.quota_mb * 1024 * 1024));
        quota.oninput = () => {
          p.quota_mb = Number(quota.value);
          size.textContent = formatSize(p.quota_mb * 1024 * 1024);
        };
        const def = h("input", { type: "radio", name: "default-plan" }) as HTMLInputElement;
        def.checked = p.id === defaultPlan || (!p.id && false);
        def.onchange = () => (defaultPlan = p.id || "");
        const del = h("button", { className: "act danger", title: "Retirer ce forfait (ses comptes passent au forfait par défaut)", onclick: () => {
          plans = plans.filter((_, k) => k !== i);
          renderPlans();
        } }, "🗑");
        return h("div", { className: "plan-row" }, name, h("span", { className: "quota" }, quota, size), h("label", { className: "def" }, def), plans.length > 1 ? del : h("span", {}));
      }),
      h("button", { className: "secondary add-plan", onclick: () => {
        plans.push({ id: "", name: "Nouveau forfait", quota_mb: 10240 });
        renderPlans();
      } }, "Ajouter un forfait"),
    );
  };
  renderPlans();

  const save = h("button", { className: "primary", onclick: async () => {
    msg.textContent = "";
    try {
      const saved = await files.setSettings({ ...st, plans, default_plan: defaultPlan, max_docs_per_user: Number(docs.value), idle_minutes: Number(idle.value), auximail_url: mail.value });
      st = saved;
      plans = saved.plans.map((p) => ({ ...p }));
      defaultPlan = saved.default_plan;
      renderPlans();
      toast("Réglages enregistrés.");
    } catch (e) {
      msg.textContent = errText(e);
    }
  } }, "Enregistrer");
  box.replaceChildren(
    h("h2", {}, "Forfaits"),
    h("p", { className: "muted" }, "L'espace d'un forfait compte tout ce qui est gardé au nom du client : documents de « Mes fichiers », courriels et pièces jointes d'AuxiMail. 1024 Mo = 1 Go. Les comptes sans forfait choisi reçoivent le forfait par défaut."),
    plansBox,
    h("h2", { className: "spaced" }, "Serveur"),
    field("Documents ouverts en même temps par compte", docs, "Chaque document de bureautique ouvert occupe un moteur sur le serveur (150 à 300 Mo de mémoire)."),
    field("Fermeture des documents inactifs (minutes)", idle, "Un document sans activité depuis ce délai est fermé et son moteur libéré (les modifications non enregistrées sont perdues)."),
    field("Adresse d'AuxiMail", mail, "Le webmail ouvert par la tuile AuxiMail : /mail/ (AuxiMailWeb sur ce serveur, connexion unique) ou une adresse https://. Vide : la tuile indique « Bientôt »."),
    msg,
    h("div", { className: "form-actions" }, save),
  );
}

async function renderStatus(box: HTMLElement) {
  try {
    const s = await files.status();
    const up = s.uptime_s;
    const uptime = up < 3600 ? `${Math.round(up / 60)} min` : up < 86400 ? `${Math.floor(up / 3600)} h ${Math.round((up % 3600) / 60)} min` : `${Math.floor(up / 86400)} j ${Math.floor((up % 86400) / 3600)} h`;
    const row = (k: string, v: string) => h("div", { className: "kv" }, h("span", { className: "muted" }, k), h("span", {}, v));
    box.replaceChildren(
      h("div", { className: "browser-head" }, h("h2", {}, "État du serveur"), h("span", { className: "spacer" }), h("button", { className: "secondary", onclick: () => void renderStatus(box) }, "Actualiser")),
      row("Version", s.version),
      row("En marche depuis", uptime),
      row("Comptes", String(s.accounts)),
      row("Espace utilisé (tous les comptes)", formatSize(s.storage)),
      row("Documents ouverts", String(s.docs_open)),
      row("Moteurs en marche", `${s.engines_running} sur ${s.engines_max} au plus (dont ${s.spares} de réserve)`),
      row("Bac à sable des moteurs", s.sandbox === "aucun" ? "aucun (à éviter sur un serveur public)" : s.sandbox),
      row("AuxiCorrect", s.auxicorrect ? `${s.auxicorrect.version ?? "installé"} — ${s.auxicorrect.cli}` : "non installé"),
      row("Taille maximale d'un document", `${s.max_open_mb} Mo`),
      row(
        "AuxiMail",
        !s.auximail
          ? "non relié (options --auximail-proxy ou --auximail-health)"
          : s.auximail.ok
            ? `${s.auximail.version ?? "en marche"} — ${s.auximail.openSpaces ?? 0} espace(s) ouvert(s)${s.auximail.mode === "auxioffice" ? ", connexion unique" : ` (mode ${s.auximail.mode})`}`
            : `injoignable : ${s.auximail.error ?? "erreur"}`,
      ),
    );
  } catch (e) {
    box.replaceChildren(h("p", {}, errText(e)));
  }
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// --- Administration des comptes ---------------------------------------------------

async function renderAdmin(box: HTMLElement) {
  let list: Account[] = [];
  let plans: Plan[] = [];
  let defaultPlan = "";
  let mailCounted = false;
  try {
    const r = await files.adminUsers();
    list = r.users;
    plans = r.plans;
    defaultPlan = r.default_plan;
    mailCounted = r.mail_counted;
  } catch (e) {
    box.replaceChildren(h("h2", {}, "Administration"), h("p", { className: "hint" }, errText(e)));
    return;
  }
  const refresh = () => void renderAdmin(box);
  const quotaLabel = (a: Account) => `${formatSize(a.used)} / ${formatSize(a.quota_mb * 1024 * 1024)}`;
  const defName = plans.find((p) => p.id === defaultPlan)?.name ?? "";
  const planOptions: [string, string][] = [["", `Forfait par défaut (${defName})`], ...plans.map((p): [string, string] => [p.id, `${p.name} — ${formatSize(p.quota_mb * 1024 * 1024)}`])];

  const add = async () => {
    const v = await form(
      "Nouveau compte",
      [
        { name: "email", label: "Courriel", type: "email" },
        { name: "name", label: "Nom affiché" },
        { name: "password", label: "Mot de passe initial (8 caractères au moins)", type: "password" },
        { name: "plan", label: "Forfait", type: "select", options: planOptions, value: "" },
        { name: "quota", label: "Espace particulier en Mo (vide : celui du forfait)", type: "number" },
        { name: "admin", label: "Administrateur (gère les comptes)", type: "checkbox" },
      ],
      "Créer le compte",
      async (v) => {
        try {
          const q = Number(v.quota);
          await files.adminAdd({ email: String(v.email), name: String(v.name), password: String(v.password), admin: !!v.admin, quota_mb: q > 0 ? q : undefined, plan: String(v.plan) || undefined });
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
        { name: "plan", label: "Forfait", type: "select", options: planOptions, value: a.plan === defaultPlan ? "" : a.plan },
        { name: "quota", label: "Espace particulier en Mo (vide ou 0 : celui du forfait)", type: "number", value: a.custom_quota ? String(a.quota_mb) : "" },
        { name: "admin", label: "Administrateur", type: "checkbox", value: a.admin },
      ],
      "Enregistrer",
      async (v) => {
        try {
          await files.adminUpdate({ email: a.email, name: String(v.name), password: String(v.password) || undefined, admin: !!v.admin, quota_mb: Number(v.quota) || 0, plan: String(v.plan) });
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
    h("div", { className: "browser-head" }, h("h2", {}, "Comptes"), h("span", { className: "spacer" }), h("button", { className: "primary", onclick: () => void add() }, "Nouveau compte…")),
    h(
      "div",
      { className: "file-list accounts" },
      ...list.map((a) =>
        h(
          "div",
          { className: "frow account" },
          h("span", { className: "name" }, a.name, h("span", { className: "mail" }, ` ${a.email}`)),
          h("span", { className: "role" }, a.admin ? "administrateur" : ""),
          h("span", { className: "plan-name" }, a.custom_quota ? "Espace particulier" : a.plan_name),
          h("span", { className: "size", title: `Documents ${formatSize(a.files)}, courriel ${formatSize(a.mail)}` }, quotaLabel(a)),
          h(
            "span",
            { className: "row-actions" },
            h("button", { className: "act", title: "Modifier (nom, mot de passe, espace, rôle)", onclick: () => void edit(a) }, "✎"),
            a.email !== me.user?.email && h("button", { className: "act danger", title: "Supprimer le compte", onclick: () => void remove(a) }, "🗑"),
          ),
        ),
      ),
    ),
    h(
      "p",
      { className: "hint" },
      "L'espace utilisé compte les documents et, ",
      mailCounted ? "le courriel (AuxiMail) de chaque compte. " : "quand AuxiMail est relié, son courriel (il ne l'est pas encore). ",
      "Un nouveau mot de passe ferme les sessions ouvertes du compte.",
    ),
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
      !e.dir &&
        me.auxicorrect !== false &&
        /\.(txt|md|markdown|text)$/i.test(e.name) &&
        h("button", { className: "act lite", title: "Corriger ce texte dans AuxiCorrect", onclick: (ev: Event) => (ev.stopPropagation(), launch("correct", [p])) }, "Corriger"),
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
