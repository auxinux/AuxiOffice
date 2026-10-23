// Fenêtre d'AuxiText : onglets, zone d'édition (une vue CodeMirror par
// onglet), barre d'état, commandes des menus, ouverture et enregistrement,
// surveillance des fichiers sur le disque.

import { useCallback, useEffect, useReducer, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { documentDir, homeDir, join } from "@tauri-apps/api/path";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import type { Text } from "@codemirror/state";
import { EditorSelection } from "@codemirror/state";
import type { EditorView, KeyBinding } from "@codemirror/view";
import { copyLineDown, deleteLine, moveLineDown, moveLineUp, redo, selectAll, toggleComment, undo } from "@codemirror/commands";
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  gotoLine,
  openSearchPanel,
  searchPanelOpen,
  selectMatches,
  selectSelectionMatches,
} from "@codemirror/search";
import { accelToKey, flatItems, menuBar } from "./actions";
import { api, asTextError, type AppInfo, type AuxiCorrectStatus, type Stat } from "./api";
import { applyPrefs, createEditor, replaceContent, sameDoc, setIndent, setLanguage, setSpelling } from "./editor";
import { shouldSpell, spellExtension } from "./spell";
import { ENCODINGS, EOLS, encodingKey, encodingLabel, eolShort, type Eol } from "./encodings";
import { detectLanguage, defaultExtension, language, LANGUAGES } from "./languages";
import { NativeMenu } from "./menus";
import { DEFAULT_PREFS, INDENT_WIDTHS, isDark, nextZoom, sanitizePrefs, type Prefs } from "./prefs";
import { detectIndent, dirName, fileName, humanSize, sortLines, textStats, trimTrailing, type Indent } from "./util";
import { Modal, Popup, PrefsForm, type Button, type ModalSpec, type PopupItem } from "./Dialogs";

/** Au-delà, pas de coloration syntaxique (fluidité). */
const NO_HIGHLIGHT_ABOVE = 5 * 1024 * 1024;
const WATCH_MS = 2000;

interface Banner {
  kind: "changed" | "deleted" | "info" | "warn";
  text: string;
}

interface Doc {
  id: number;
  path: string | null;
  untitled: number;
  view: EditorView;
  host: HTMLDivElement;
  encoding: string;
  bom: boolean;
  eol: Eol;
  /** Encodage choisi par l'utilisateur (gardé au rechargement). */
  encodingForced: boolean;
  lang: string;
  langAuto: boolean;
  /** Réglage de correction appliqué (« off », « qc », « intl ») : évite de relancer pour rien. */
  spell: string;
  indent: Indent;
  saved: Text;
  savedMeta: string;
  modified: boolean;
  /** Fichier supprimé ou déplacé sur le disque. */
  missing: boolean;
  /** Dernier état connu du fichier sur le disque. */
  stat: Stat | null;
  readonly: boolean;
  banner: Banner | null;
}

const meta = (d: { encoding: string; bom: boolean; eol: Eol }) => `${d.encoding}|${d.bom}|${d.eol}`;
const docName = (d: Doc) => (d.path ? fileName(d.path) : d.untitled > 1 ? `Sans titre ${d.untitled}` : "Sans titre");
const isDirty = (d: Doc) => d.modified || d.missing;

let nextId = 1;

export default function App() {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const docs = useRef<Doc[]>([]);
  const [activeId, setActiveId] = useState(0);
  const activeRef = useRef(0);
  activeRef.current = activeId;
  const [prefs, setPrefsState] = useState<Prefs | null>(null);
  const prefsRef = useRef<Prefs>(DEFAULT_PREFS);
  const [systemDark, setSystemDark] = useState<boolean | null>(null);
  const systemFromShell = useRef(false);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const recentRef = useRef<string[]>([]);
  recentRef.current = recent;
  const [modal, setModal] = useState<(ModalSpec & { resolve: (v: string) => void }) | null>(null);
  const modalQueue = useRef<(ModalSpec & { resolve: (v: string) => void })[]>([]);
  const infoRef = useRef<AppInfo | null>(null);
  infoRef.current = info;
  // AuxiCorrect : réglage commun relu au démarrage et au retour dans la fenêtre.
  const [ac, setAc] = useState<AuxiCorrectStatus | null>(null);
  const acRef = useRef<AuxiCorrectStatus | null>(null);
  acRef.current = ac;
  const [popup, setPopup] = useState<{ kind: "lang" | "enc" | "reopen" | "eol" | "indent"; x: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const editors = useRef<HTMLDivElement>(null);
  const menu = useRef<NativeMenu | null>(null);
  const closing = useRef(false);

  const dark = isDark(prefs?.theme ?? "system", systemDark);
  const darkRef = useRef(dark);
  darkRef.current = dark;

  const active = (): Doc | undefined => docs.current.find((d) => d.id === activeRef.current);
  const byId = (id: number) => docs.current.find((d) => d.id === id);

  // --- Boîtes de dialogue ---------------------------------------------------

  const ask = useCallback(
    (title: string, body: ReactNode, buttons: Button[], opts: { cancel?: string; wide?: boolean } = {}) =>
      new Promise<string>((resolve) => {
        // Une question à la fois : les suivantes attendent leur tour.
        modalQueue.current.push({ title, body, buttons, ...opts, resolve });
        if (modalQueue.current.length === 1) setModal(modalQueue.current[0]);
      }),
    [],
  );
  const tell = useCallback((title: string, body: ReactNode) => ask(title, body, [{ label: "OK", value: "ok", kind: "primary" }]), [ask]);
  const flash = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((t) => (t === text ? null : t)), 4000);
  }, []);

  // --- Préférences et thème -------------------------------------------------

  const applyAll = useCallback((p: Prefs, d: boolean) => {
    for (const doc of docs.current) applyPrefs(doc.view, p, d);
  }, []);

  /** Active ou retire la correction d'AuxiCorrect d'un document (texte brut, Markdown). */
  const applySpell = useCallback((d: Doc) => {
    const p = prefsRef.current;
    const on = shouldSpell(d.lang, p.spelling && !!acRef.current?.enabled, d.view.state.doc.length);
    const want = on ? (p.spellInternational ? "intl" : "qc") : "off";
    if (want === d.spell) return;
    d.spell = want;
    setSpelling(
      d.view,
      on
        ? spellExtension(p.spellInternational, (msg) => {
            d.banner = { kind: "warn", text: `AuxiCorrect n'a pas pu vérifier ce texte : ${msg}` };
            bump();
          })
        : null,
    );
  }, []);
  const applySpellAll = useCallback(() => docs.current.forEach(applySpell), [applySpell]);

  const refreshAuxiCorrect = useCallback(async () => {
    const s = await api.auxicorrectStatus().catch(() => null);
    const old = acRef.current;
    acRef.current = s;
    setAc(s);
    applySpellAll();
    // AuxiCorrect installé ou retiré : son sous-menu apparaît ou disparaît.
    if (!!old?.installed !== !!s?.installed && menu.current && infoRef.current) {
      await menu.current.install(menuBar({ writer: infoRef.current.writer, auxicorrect: !!s?.installed })).catch(() => {});
      await menu.current.setRecent(recentRef.current).catch(() => {});
    }
  }, [applySpellAll]);

  const savePrefsTimer = useRef(0);
  const setPrefs = useCallback(
    (p: Prefs, persist = true) => {
      const old = prefsRef.current;
      prefsRef.current = p;
      setPrefsState(p);
      // Indentation par défaut changée : documents sans indentation propre.
      if (old.indentWidth !== p.indentWidth || old.indentWithTabs !== p.indentWithTabs) {
        for (const d of docs.current) {
          const own = p.detectIndent ? detectIndent(d.view.state.doc.sliceString(0, 200_000)) : null;
          if (!own) {
            d.indent = { tabs: p.indentWithTabs, width: p.indentWidth };
            setIndent(d.view, d.indent);
          }
        }
      }
      if (old.spelling !== p.spelling || old.spellInternational !== p.spellInternational) applySpellAll();
      if (persist) {
        window.clearTimeout(savePrefsTimer.current);
        savePrefsTimer.current = window.setTimeout(() => void api.prefsSave(p).catch((e) => console.warn("préférences", e)), 300);
      }
    },
    [],
  );

  const refreshSystemTheme = useCallback(async () => {
    const t = await api.systemTheme().catch(() => null);
    systemFromShell.current = t !== null;
    setSystemDark(t !== null ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);

  useEffect(() => {
    if (!prefs) return;
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    applyAll(prefs, dark);
    // Thème GTK de la fenêtre (barre de menus) : celui de la page, sauf en
    // « système » sans réponse de la coque (on suit alors GTK lui-même).
    const follow = prefs.theme === "system" && !systemFromShell.current;
    void getCurrentWindow()
      .setTheme(follow ? null : dark ? "dark" : "light")
      .catch(() => {});
  }, [prefs, dark, applyAll]);

  // --- Documents ------------------------------------------------------------

  const updateTitle = useCallback(() => {
    const d = active();
    const name = d ? docName(d) : "";
    void getCurrentWindow()
      .setTitle(d ? `${isDirty(d) ? "• " : ""}${name}${d.path ? ` (${dirName(d.path)})` : ""} — AuxiText` : "AuxiText")
      .catch(() => {});
  }, []);

  const runRef = useRef<(id: string) => void>(() => {});
  const editorKeys = useRef<KeyBinding[]>([]);
  if (!editorKeys.current.length) {
    // Raccourcis des menus, aussi dans la page (quand la barre native ne les intercepte pas).
    const seen = new Set<string>();
    for (const it of flatItems(menuBar({ writer: true, auxicorrect: true }))) {
      if (!it.accel) continue;
      const key = accelToKey(it.accel);
      if (seen.has(key)) continue;
      seen.add(key);
      editorKeys.current.push({ key, run: () => (runRef.current(it.id), true), preventDefault: true });
    }
    const extra: [string, string][] = [
      ["Mod-Shift-z", "redo"],
      ["Mod-+", "zoomIn"],
      ["Mod-Tab", "nextTab"],
      ["Mod-PageDown", "nextTab"],
      ["Mod-Shift-Tab", "prevTab"],
      ["Mod-PageUp", "prevTab"],
    ];
    for (const [key, id] of extra) editorKeys.current.push({ key, run: () => (runRef.current(id), true), preventDefault: true });
  }

  const onEditorUpdate = useCallback(
    (view: EditorView, docChanged: boolean) => {
      const d = docs.current.find((x) => x.view === view);
      if (!d) return;
      if (docChanged) {
        const was = d.modified;
        d.modified = !sameDoc(view.state.doc, d.saved) || meta(d) !== d.savedMeta;
        if (was !== d.modified && d.id === activeRef.current) updateTitle();
      }
      if (d.id === activeRef.current) bump();
    },
    [updateTitle],
  );

  const addDoc = useCallback(
    (o: { path: string | null; text: string; encoding?: string; bom?: boolean; eol?: Eol; stat?: Stat | null; readonly?: boolean; banner?: Banner | null; encodingForced?: boolean }) => {
      const p = prefsRef.current;
      const host = document.createElement("div");
      host.className = "editor-host";
      host.hidden = true;
      editors.current?.appendChild(host);
      const firstLine = o.text.slice(0, Math.min(o.text.indexOf("\n") >>> 0, 300));
      const big = o.text.length > NO_HIGHLIGHT_ABOVE;
      const lang = big ? "plain" : detectLanguage(o.path, firstLine);
      const own = p.detectIndent ? detectIndent(o.text) : null;
      const indent: Indent = own ? { tabs: own.tabs, width: own.width || p.indentWidth } : { tabs: p.indentWithTabs, width: p.indentWidth };
      const view = createEditor(host, o.text, { prefs: p, dark: darkRef.current, indent, keys: editorKeys.current, onUpdate: onEditorUpdate });
      const used = new Set(docs.current.filter((d) => !d.path).map((d) => d.untitled));
      let untitled = 0;
      if (!o.path) {
        untitled = 1;
        while (used.has(untitled)) untitled++;
      }
      const d: Doc = {
        id: nextId++,
        path: o.path,
        untitled,
        view,
        host,
        encoding: o.encoding ?? "UTF-8",
        bom: o.bom ?? false,
        eol: o.eol ?? (infoRef.current?.platform === "windows" ? "crlf" : "lf"),
        encodingForced: o.encodingForced ?? false,
        lang,
        langAuto: true,
        spell: "off",
        indent,
        saved: view.state.doc,
        savedMeta: "",
        modified: false,
        missing: false,
        stat: o.stat ?? null,
        readonly: o.readonly ?? false,
        banner: o.banner ?? (big ? { kind: "info", text: "Fichier volumineux : coloration syntaxique désactivée." } : null),
      };
      d.savedMeta = meta(d);
      docs.current.push(d);
      if (lang !== "plain") void setLanguage(view, lang);
      applySpell(d);
      return d;
    },
    [onEditorUpdate, applySpell],
  );

  const activate = useCallback(
    (id: number) => {
      activeRef.current = id;
      setActiveId(id);
      for (const d of docs.current) d.host.hidden = d.id !== id;
      const d = byId(id);
      if (d) {
        requestAnimationFrame(() => {
          d.view.requestMeasure();
          if (!modalOpen.current) d.view.focus();
        });
      }
      updateTitle();
      setPopup(null);
    },
    [updateTitle],
  );
  const modalOpen = useRef(false);
  modalOpen.current = !!modal;

  /** Document vierge et intact (remplacé par le premier fichier ouvert). */
  const pristine = (d: Doc | undefined) => !!d && !d.path && !d.modified && d.view.state.doc.length === 0;

  const newDoc = useCallback(() => {
    const d = addDoc({ path: null, text: "" });
    activate(d.id);
    return d;
  }, [addDoc, activate]);

  const destroyDoc = useCallback((d: Doc) => {
    d.view.destroy();
    d.host.remove();
    docs.current = docs.current.filter((x) => x !== d);
  }, []);

  const addRecent = useCallback((path: string) => {
    void api
      .recent({ add: path })
      .then(setRecent)
      .catch(() => {});
  }, []);

  /** Ouvre un fichier (ou l'active s'il est déjà ouvert). */
  const openOne = useCallback(
    async (path: string, opts: { force?: boolean; recent?: boolean } = {}): Promise<Doc | null> => {
      const already = docs.current.find((d) => d.path === path);
      if (already) {
        activate(already.id);
        return already;
      }
      try {
        const r = await api.readText(path, undefined, opts.force);
        const banners: Banner[] = [];
        if (r.lossy) banners.push({ kind: "warn", text: `Certains octets ne sont pas valides en ${encodingLabel(r.encoding, r.bom)} : ils sont affichés « � » et seraient perdus à l'enregistrement. Essayez Outils → Rouvrir avec l'encodage.` });
        if (r.mixed_eol) banners.push({ kind: "warn", text: `Fins de ligne mélangées : elles seront enregistrées en ${eolShort(r.eol)}.` });
        if (r.readonly) banners.push({ kind: "info", text: "Lecture seule : vous ne pouvez pas modifier ce fichier. Utilisez « Enregistrer sous… » pour en garder une copie." });
        const prev = active();
        const d = addDoc({ path, text: r.text, encoding: r.encoding, bom: r.bom, eol: r.eol, stat: r.stat, readonly: r.readonly, banner: banners[0] ?? null });
        if (pristine(prev) && prev) destroyDoc(prev);
        activate(d.id);
        addRecent(path);
        return d;
      } catch (e) {
        const err = asTextError(e);
        if (err.code === "large") {
          const v = await ask("Fichier volumineux", `${err.message} Ouvrir quand même ?`, [
            { label: "Ouvrir quand même", value: "open", kind: "primary" },
            { label: "Annuler", value: "cancel" },
          ]);
          return v === "open" ? openOne(path, { ...opts, force: true }) : null;
        }
        if (err.code === "notfound" && opts.recent) {
          void api.recent({ remove: path }).then(setRecent);
          await tell("Fichier introuvable", `« ${path} » n'existe plus : il est retiré des fichiers récents.`);
          return null;
        }
        if (err.code === "notfound") {
          // Fichier à créer (`auxitext nouveau.txt`).
          const prev = active();
          const d = addDoc({ path, text: "", stat: { exists: false, mtime: 0, size: 0 }, banner: { kind: "info", text: "Nouveau fichier : il sera créé à l'enregistrement." } });
          if (pristine(prev) && prev) destroyDoc(prev);
          activate(d.id);
          return d;
        }
        if (err.code === "binary") {
          await tell("Ouverture impossible", `« ${fileName(path)} » n'est pas un fichier texte (fichier binaire) : AuxiText ne peut pas l'ouvrir.`);
        } else {
          await tell("Ouverture impossible", err.message);
        }
        return null;
      }
    },
    [activate, addDoc, addRecent, ask, destroyDoc, tell],
  );

  const openPaths = useCallback(
    async (paths: string[]) => {
      for (const p of paths) await openOne(p);
      if (!docs.current.length) newDoc();
    },
    [openOne, newDoc],
  );

  /** Dossier de départ des dialogues : celui du dernier fichier, sinon Documents ou le dossier personnel. */
  const startDir = async (): Promise<string> => {
    const last = docs.current.filter((x) => x.path).pop()?.path ?? recentRef.current[0];
    if (last) return dirName(last);
    return documentDir().catch(() => homeDir());
  };

  const openWithDialog = useCallback(async () => {
    const d = active();
    const sel = await openDialog({
      multiple: true,
      directory: false,
      title: "Ouvrir",
      defaultPath: d?.path ? dirName(d.path) : await startDir(),
      filters: [
        { name: "Tous les fichiers", extensions: ["*"] },
        { name: "Fichiers texte", extensions: ["txt", "md", "log", "json", "xml", "yaml", "yml", "ini", "conf", "cfg", "toml", "csv", "sh", "py", "js", "ts", "html", "css", "c", "h", "cpp", "rs"] },
      ],
    }).catch(() => null);
    if (!sel) return;
    await openPaths(Array.isArray(sel) ? sel : [sel]);
  }, [openPaths]);

  // --- Enregistrement --------------------------------------------------------

  const markSaved = (d: Doc, path: string, stat: Stat) => {
    const renamed = d.path !== path;
    d.path = path;
    d.untitled = 0;
    d.saved = d.view.state.doc;
    d.savedMeta = meta(d);
    d.modified = false;
    d.missing = false;
    d.stat = stat;
    d.readonly = false;
    if (d.banner && d.banner.kind !== "warn") d.banner = null;
    if (renamed && d.langAuto) {
      const lang = detectLanguage(path, d.view.state.doc.line(1).text);
      if (lang !== d.lang) {
        d.lang = lang;
        void setLanguage(d.view, lang);
        applySpell(d);
      }
    }
  };

  const save = useCallback(
    async (d: Doc, as = false): Promise<boolean> => {
      let path = d.path;
      if (!path || as) {
        const base = d.path ? d.path : await join(await startDir(), `${docName(d)}.${defaultExtension(d.lang)}`);
        const chosen = await saveDialog({ title: as ? "Enregistrer sous" : "Enregistrer", defaultPath: base }).catch(() => null);
        if (!chosen) return false;
        path = chosen;
      }
      for (;;) {
        try {
          const stat = await api.writeText(path, d.view.state.doc.toString(), d.encoding, d.bom, d.eol);
          markSaved(d, path, stat);
          addRecent(path);
          updateTitle();
          bump();
          flash(`Enregistré : ${path}`);
          return true;
        } catch (e) {
          const err = asTextError(e);
          if (err.code === "unmappable") {
            const v = await ask("Encodage", `${err.message} Enregistrer en UTF-8 (tous les caractères y existent) ?`, [
              { label: "Enregistrer en UTF-8", value: "utf8", kind: "primary" },
              { label: "Annuler", value: "cancel" },
            ]);
            if (v !== "utf8") return false;
            d.encoding = "UTF-8";
            d.bom = false;
            continue;
          }
          const v = await ask("Enregistrement impossible", err.message, [
            { label: "Enregistrer sous…", value: "as", kind: "primary" },
            { label: "Annuler", value: "cancel" },
          ]);
          return v === "as" ? save(d, true) : false;
        }
      }
    },
    [addRecent, ask, flash, updateTitle],
  );

  /** Demande d'enregistrer un document modifié. Vrai si on peut le fermer. */
  const confirmClose = useCallback(
    async (d: Doc): Promise<boolean> => {
      if (!isDirty(d)) return true;
      activate(d.id);
      const v = await ask(
        "Enregistrer les modifications ?",
        d.missing && !d.modified
          ? `« ${docName(d)} » a été supprimé ou déplacé sur le disque. L'enregistrer de nouveau avant de fermer ?`
          : `Enregistrer les modifications apportées à « ${docName(d)} » avant de fermer ? Sinon, elles seront perdues.`,
        [
          { label: "Enregistrer", value: "save", kind: "primary" },
          { label: "Ne pas enregistrer", value: "discard", kind: "danger" },
          { label: "Annuler", value: "cancel" },
        ],
      );
      if (v === "save") return save(d);
      return v === "discard";
    },
    [activate, ask, save],
  );

  const closeDoc = useCallback(
    async (d: Doc) => {
      if (!(await confirmClose(d))) return;
      const i = docs.current.indexOf(d);
      destroyDoc(d);
      if (!docs.current.length) {
        newDoc();
      } else if (d.id === activeRef.current) {
        activate(docs.current[Math.min(i, docs.current.length - 1)].id);
      } else bump();
    },
    [activate, confirmClose, destroyDoc, newDoc],
  );

  /** Fermeture de la fenêtre : chaque document modifié est proposé à l'enregistrement. */
  const closeWindow = useCallback(async () => {
    for (const d of [...docs.current]) {
      if (!(await confirmClose(d))) return false;
    }
    closing.current = true;
    await getCurrentWindow().destroy();
    return true;
  }, [confirmClose]);

  // --- Rechargement et encodages --------------------------------------------

  const reload = useCallback(
    async (d: Doc, encoding?: string, confirm = true) => {
      if (!d.path) return;
      if (confirm && d.modified) {
        const v = await ask("Recharger", `Abandonner vos modifications de « ${docName(d)} » et relire le fichier sur le disque ?`, [
          { label: "Recharger", value: "reload", kind: "danger" },
          { label: "Annuler", value: "cancel" },
        ]);
        if (v !== "reload") return;
      }
      const forced = encoding ?? (d.encodingForced ? d.encoding : undefined);
      try {
        const r = await api.readText(d.path, forced, true);
        replaceContent(d.view, r.text);
        d.encoding = r.encoding;
        d.bom = r.bom;
        d.eol = r.eol;
        d.encodingForced = !!forced;
        d.saved = d.view.state.doc;
        d.savedMeta = meta(d);
        d.modified = false;
        d.missing = false;
        d.stat = r.stat;
        d.readonly = r.readonly;
        d.banner = r.lossy ? { kind: "warn", text: `Certains octets ne sont pas valides en ${encodingLabel(r.encoding, r.bom)} (affichés « � »).` } : null;
        updateTitle();
        bump();
        flash(encoding ? `Rouvert en ${encodingLabel(r.encoding, r.bom)}` : "Fichier rechargé");
      } catch (e) {
        await tell("Rechargement impossible", asTextError(e).message);
      }
    },
    [ask, flash, tell, updateTitle],
  );

  const setMeta = (d: Doc, m: Partial<Pick<Doc, "encoding" | "bom" | "eol">>) => {
    Object.assign(d, m);
    d.modified = !sameDoc(d.view.state.doc, d.saved) || meta(d) !== d.savedMeta;
    if ("encoding" in m) d.encodingForced = true;
    updateTitle();
    bump();
  };

  const setDocLanguage = (d: Doc, id: string) => {
    d.lang = id;
    d.langAuto = false;
    void setLanguage(d.view, id);
    applySpell(d);
    bump();
  };

  const setDocIndent = (d: Doc, indent: Indent) => {
    d.indent = indent;
    setIndent(d.view, indent);
    bump();
  };

  // --- Surveillance du disque ------------------------------------------------

  const checkDisk = useCallback(async () => {
    const watched = docs.current.filter((d) => d.path && d.stat);
    if (!watched.length) return;
    const stats = await api.statFiles(watched.map((d) => d.path!)).catch(() => null);
    if (!stats) return;
    let changed = false;
    watched.forEach((d, i) => {
      const s = stats[i];
      const known = d.stat!;
      if (!s.exists && known.exists) {
        d.missing = true;
        d.stat = s;
        d.banner = { kind: "deleted", text: "Le fichier a été supprimé ou déplacé sur le disque. Enregistrez pour le recréer." };
        changed = true;
      } else if (s.exists && (!known.exists || s.mtime !== known.mtime || s.size !== known.size)) {
        d.stat = s;
        d.missing = false;
        d.banner = {
          kind: "changed",
          text: d.modified ? "Le fichier a été modifié par un autre programme. Recharger ? (vos modifications seraient perdues)" : "Le fichier a été modifié par un autre programme. Recharger ?",
        };
        changed = true;
      }
    });
    if (changed) {
      updateTitle();
      bump();
    }
  }, [updateTitle]);

  // --- Impression ------------------------------------------------------------

  const print = useCallback(async (d: Doc) => {
    const area = document.getElementById("print-area");
    if (!area) return;
    area.replaceChildren();
    const h = document.createElement("div");
    h.className = "print-title";
    h.textContent = d.path ?? docName(d);
    const pre = document.createElement("pre");
    pre.textContent = d.view.state.doc.toString();
    pre.style.tabSize = String(d.indent.width || 4);
    area.append(h, pre);
    try {
      await api.printPage();
    } catch (e) {
      await tell("Impression impossible", String(e));
    }
  }, [tell]);

  // --- Commandes -------------------------------------------------------------

  /** Champ de saisie (recherche, boîte de dialogue) qui a le focus, hors éditeur. */
  const focusedField = (): HTMLInputElement | HTMLTextAreaElement | null => {
    const el = document.activeElement;
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : null;
  };

  const transformSelection = (view: EditorView, f: (s: string) => string, wholeIfEmpty: "word" | "lines" | "doc") => {
    const st = view.state;
    const tr = st.changeByRange((r) => {
      let from = r.from;
      let to = r.to;
      if (r.empty) {
        if (wholeIfEmpty === "word") {
          const w = st.wordAt(r.head);
          if (!w) return { range: r };
          ({ from, to } = w);
        } else if (wholeIfEmpty === "doc") {
          from = 0;
          to = st.doc.length;
        }
      }
      if (wholeIfEmpty !== "word") {
        from = st.doc.lineAt(from).from;
        to = st.doc.lineAt(to).to;
      }
      const text = f(st.sliceDoc(from, to));
      return { changes: { from, to, insert: text }, range: r.empty ? EditorSelection.cursor(Math.min(r.head, from + text.length)) : EditorSelection.range(from, from + text.length) };
    });
    view.dispatch(st.update(tr, { scrollIntoView: true, userEvent: "input" }));
  };

  const lastRun = useRef({ id: "", t: 0 });
  const run = 
    (id: string) => {
      // Un raccourci peut arriver à la fois par la barre de menus et par la
      // page : ignorer le doublon immédiat (sauf les commandes répétables).
      const now = performance.now();
      const repeatable = /^(undo|redo|zoom|findNext|findPrev|moveLine|deleteLine|duplicateLine|nextTab|prevTab)/.test(id);
      if (!repeatable && lastRun.current.id === id && now - lastRun.current.t < 300) return;
      lastRun.current = { id, t: now };
      if (modalOpen.current && !/^(undo|redo|selectAll)$/.test(id)) return;
      menu.current?.invalidate(id);
      const d = active();
      const view = d?.view;
      const p = prefsRef.current;
      const field = focusedField();

      if (id.startsWith("recent:")) return void openOne(id.slice(7), { recent: true });
      if (id.startsWith("lang.") && d) return setDocLanguage(d, id.slice(5));
      if (id.startsWith("enc.") && d) {
        const e = ENCODINGS[Number(id.slice(4))];
        if (e) setMeta(d, { encoding: e.encoding, bom: e.bom });
        return;
      }
      if (id.startsWith("reopen.") && d) {
        const e = ENCODINGS[Number(id.slice(7))];
        if (e && d.path) void reload(d, e.encoding);
        else if (e) flash("Le document n'est pas encore enregistré : choisissez l'encodage d'enregistrement.");
        return;
      }
      if (id.startsWith("eol.") && d) return setMeta(d, { eol: id.slice(4) as Eol });
      if (id.startsWith("theme.")) return setPrefs({ ...p, theme: id.slice(6) as Prefs["theme"] });
      if (id === "indent.tabs" && d) return setDocIndent(d, { tabs: true, width: d.indent.width || p.indentWidth });
      if (id === "indent.spaces" && d) return setDocIndent(d, { tabs: false, width: d.indent.width || p.indentWidth });
      if (id.startsWith("indent.w.") && d) return setDocIndent(d, { ...d.indent, width: Number(id.slice(9)) });

      switch (id) {
        case "new":
          return void newDoc();
        case "newWindow":
          return void api.newWindow().catch((e) => tell("Nouvelle fenêtre", String(e)));
        case "open":
          return void openWithDialog();
        case "clearRecent":
          return void api.recent({ clear: true }).then(setRecent);
        case "save":
          return d ? void save(d) : undefined;
        case "saveAs":
          return d ? void save(d, true) : undefined;
        case "saveAll":
          return void (async () => {
            for (const x of [...docs.current]) if (isDirty(x) && !(await save(x))) break;
          })();
        case "reload":
          return d?.path ? void reload(d) : undefined;
        case "openInWriter":
          return void (async () => {
            if (!d) return;
            if (!d.path || isDirty(d)) {
              const v = await ask("Ouvrir dans AuxiWriter", "Le document doit d'abord être enregistré. L'enregistrer maintenant ?", [
                { label: "Enregistrer", value: "save", kind: "primary" },
                { label: "Annuler", value: "cancel" },
              ]);
              if (v !== "save" || !(await save(d))) return;
            }
            await api.openInWriter(d.path!).catch((e) => tell("Ouvrir dans AuxiWriter", String(e)));
          })();
        case "print":
          return d ? void print(d) : undefined;
        case "closeTab":
          return d ? void closeDoc(d) : undefined;
        case "closeWindow":
          return void closeWindow();
        case "quit":
          return void (async () => {
            // Les autres fenêtres d'abord : chacune pose ses propres questions.
            const me = getCurrentWindow().label;
            for (const w of await getAllWebviewWindows()) if (w.label !== me) await w.close().catch(() => {});
            await closeWindow();
          })();
        case "undo":
          if (field) return void document.execCommand("undo");
          return view ? void undo(view) : undefined;
        case "redo":
          if (field) return void document.execCommand("redo");
          return view ? void redo(view) : undefined;
        case "selectAll":
          if (field) return field.select();
          return view ? void selectAll(view) : undefined;
        case "duplicateLine":
          return view ? void copyLineDown(view) : undefined;
        case "deleteLine":
          return view ? void deleteLine(view) : undefined;
        case "moveLineUp":
          return view ? void moveLineUp(view) : undefined;
        case "moveLineDown":
          return view ? void moveLineDown(view) : undefined;
        case "toggleComment":
          return view ? void toggleComment(view) : undefined;
        case "upper":
          return view ? transformSelection(view, (s) => s.toLocaleUpperCase("fr-CA"), "word") : undefined;
        case "lower":
          return view ? transformSelection(view, (s) => s.toLocaleLowerCase("fr-CA"), "word") : undefined;
        case "sortAsc":
        case "sortDesc":
          return view ? transformSelection(view, (s) => sortLines(s.split("\n"), id === "sortDesc").join("\n"), "doc") : undefined;
        case "trimTrailing":
          return view ? transformSelection(view, trimTrailing, "doc") : undefined;
        case "tabsToSpaces":
        case "spacesToTabs":
          if (!view || !d) return;
          {
            const w = d.indent.width || p.indentWidth;
            const conv =
              id === "tabsToSpaces"
                ? (s: string) => s.replace(/^\t+/gm, (m) => " ".repeat(m.length * w))
                : (s: string) => s.replace(/^( +)/gm, (m) => "\t".repeat(Math.floor(m.length / w)) + " ".repeat(m.length % w));
            transformSelection(view, conv, "doc");
            setDocIndent(d, { tabs: id === "spacesToTabs", width: w });
          }
          return;
        case "find":
          if (!view) return;
          openSearchPanel(view);
          requestAnimationFrame(() => view.dom.querySelector<HTMLInputElement>(".cm-search input[name=search]")?.select());
          return;
        case "replace":
          if (!view) return;
          openSearchPanel(view);
          requestAnimationFrame(() => {
            const search = view.dom.querySelector<HTMLInputElement>(".cm-search input[name=search]");
            const repl = view.dom.querySelector<HTMLInputElement>(".cm-search input[name=replace]");
            (search && !search.value ? search : repl)?.select();
          });
          return;
        case "findNext":
          return view ? void findNext(view) : undefined;
        case "findPrev":
          return view ? void findPrevious(view) : undefined;
        case "selectAllMatches":
          if (!view) return;
          if (searchPanelOpen(view.state) && getSearchQuery(view.state).valid) {
            selectMatches(view);
            closeSearchPanel(view);
            view.focus();
          } else selectSelectionMatches(view);
          return;
        case "gotoLine":
          return view ? void gotoLine(view) : undefined;
        case "wrap":
        case "lineNumbers":
        case "highlightLine":
        case "showWhitespace":
          return setPrefs({ ...p, [id]: !p[id] });
        case "zoomIn":
          return setPrefs({ ...p, zoom: nextZoom(p.zoom, 1) });
        case "zoomOut":
          return setPrefs({ ...p, zoom: nextZoom(p.zoom, -1) });
        case "zoomReset":
          return setPrefs({ ...p, zoom: 1 });
        case "nextTab":
        case "prevTab": {
          const list = docs.current;
          const i = list.findIndex((x) => x.id === activeRef.current);
          if (list.length > 1) activate(list[(i + (id === "nextTab" ? 1 : -1) + list.length) % list.length].id);
          return;
        }
        case "spelling":
        case "spellInternational":
          if (!acRef.current?.enabled) {
            return void tell(
              "AuxiCorrect",
              acRef.current?.installed
                ? "AuxiCorrect est installé, mais pas activé pour AuxiText. Ouvrez AuxiCorrect → Paramètres → Intégration et cochez AuxiText."
                : "AuxiCorrect n'est pas installé.",
            );
          }
          return setPrefs({ ...p, [id]: !p[id] });
        case "auxicorrectApp":
          return void api.auxicorrectOpen().catch((e) => tell("AuxiCorrect", String(e)));
        case "stats":
          return void (d && showStats(d));
        case "preferences":
          return void showPrefs();
        case "about":
          return void showAbout();
        case "licenses":
          return void showLicenses();
      }
    };
  runRef.current = run;

  const showStats = (d: Doc) => {
    const text = d.view.state.doc.toString();
    const s = textStats(text);
    const sel = d.view.state.selection.ranges.reduce((n, r) => n + r.to - r.from, 0);
    const fmt = (n: number) => n.toLocaleString("fr-CA");
    void tell(
      "Statistiques du document",
      <table className="stats">
        <tbody>
          <tr><th>Lignes</th><td>{fmt(s.lines)}</td></tr>
          <tr><th>Mots</th><td>{fmt(s.words)}</td></tr>
          <tr><th>Caractères</th><td>{fmt(s.chars)}</td></tr>
          <tr><th>Caractères hors espaces</th><td>{fmt(s.charsNoSpaces)}</td></tr>
          {sel > 0 && <tr><th>Sélection</th><td>{fmt(sel)} caractères</td></tr>}
          {d.stat?.exists && <tr><th>Taille sur le disque</th><td>{humanSize(d.stat.size)}</td></tr>}
          <tr><th>Encodage</th><td>{encodingLabel(d.encoding, d.bom)}, {eolShort(d.eol)}</td></tr>
        </tbody>
      </table>,
    );
  };

  const showPrefs = () => {
    // Formulaire vivant : chaque changement s'applique tout de suite.
    const Live = () => {
      const [p, setP] = useState(prefsRef.current);
      return (
        <PrefsForm
          prefs={p}
          onChange={(n) => {
            const clean = sanitizePrefs(n);
            setP(clean);
            setPrefs(clean);
          }}
        />
      );
    };
    void ask("Préférences", <Live />, [{ label: "Fermer", value: "close", kind: "primary" }], { wide: true });
  };

  const showAbout = () => {
    void tell(
      "À propos d'AuxiText",
      <div className="about">
        <img src="/auxitext.svg" alt="" width={64} height={64} />
        <div>
          <h3>AuxiText {info?.version}</h3>
          <p>Éditeur de texte de l'écosystème AuxiNux.</p>
          <p>Sans compte, sans télémétrie, fonctionne hors ligne.</p>
          <p>© 2026 Projet AuxiNux — office.auxinux.ca</p>
        </div>
      </div>,
    );
  };

  const showLicenses = () => {
    void tell(
      "Licences",
      <div className="licenses">
        <p>AuxiText est un logiciel propriétaire du Projet AuxiNux. Il utilise les composants libres suivants :</p>
        <ul>
          <li>CodeMirror 6 et Lezer (éditeur, coloration) — MIT</li>
          <li>React — MIT</li>
          <li>Tauri, wry, tao, muda — MIT ou Apache-2.0</li>
          <li>encoding_rs — MIT ou Apache-2.0 ; chardetng — MIT ou Apache-2.0</li>
          <li>serde, serde_json — MIT ou Apache-2.0</li>
          <li>WebKitGTK (Linux, bibliothèque du système, liée dynamiquement) — LGPL-2.1</li>
        </ul>
      </div>,
    );
  };

  // --- Démarrage et événements -------------------------------------------------

  useEffect(() => {
    let disposed = false;
    const unlisten: (() => void)[] = [];
    (async () => {
      const [i, rawPrefs, list] = await Promise.all([api.appInfo(), api.prefsLoad().catch(() => ({})), api.recent().catch(() => [])]);
      if (disposed) return;
      const p = sanitizePrefs(rawPrefs);
      prefsRef.current = p;
      setInfo(i);
      setPrefsState(p);
      setRecent(list);
      await refreshSystemTheme();
      const m = new NativeMenu((id) => runRef.current(id));
      menu.current = m;
      const acs = await api.auxicorrectStatus().catch(() => null);
      acRef.current = acs;
      setAc(acs);
      await m.install(menuBar({ writer: i.writer, auxicorrect: !!acs?.installed })).catch((e) => console.warn("menus", e));
      await m.setRecent(list).catch(() => {});
      const files = await api.takeLaunches().catch(() => []);
      if (files.length) await openPaths(files);
      else newDoc();

      const w = getCurrentWindow();
      unlisten.push(await listen("launch", async () => openPaths(await api.takeLaunches())));
      unlisten.push(await listen<unknown>("prefs", (e) => setPrefs(sanitizePrefs(e.payload), false)));
      unlisten.push(await listen<string[]>("recent", (e) => setRecent(e.payload)));
      unlisten.push(
        await getCurrentWebview().onDragDropEvent((e) => {
          if (e.payload.type === "drop" && e.payload.paths.length) void openPaths(e.payload.paths);
        }),
      );
      unlisten.push(
        await w.onCloseRequested(async (ev) => {
          if (closing.current) return;
          ev.preventDefault();
          await closeWindow();
        }),
      );
      unlisten.push(
        await w.onFocusChanged(({ payload: focused }) => {
          if (!focused) return;
          void checkDisk();
          void refreshSystemTheme();
          void refreshAuxiCorrect();
          void menu.current?.activate();
        }),
      );
      unlisten.push(await w.onThemeChanged(() => void refreshSystemTheme()));
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onMq = () => void refreshSystemTheme();
      mq.addEventListener("change", onMq);
      unlisten.push(() => mq.removeEventListener("change", onMq));
      const timer = window.setInterval(() => void checkDisk(), WATCH_MS);
      unlisten.push(() => window.clearInterval(timer));
    })().catch((e) => console.error("démarrage", e));
    return () => {
      disposed = true;
      unlisten.forEach((f) => f());
    };
  }, []);

  useEffect(() => {
    void menu.current?.setRecent(recent).catch(() => {});
  }, [recent]);

  // Ctrl+molette : zoom.
  useEffect(() => {
    const el = editors.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      runRef.current(e.deltaY < 0 ? "zoomIn" : "zoomOut");
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [prefs === null]);

  // Coches des menus selon le document actif et les préférences.
  const d = docs.current.find((x) => x.id === activeId);
  useEffect(() => {
    const m = menu.current;
    if (!m || !prefs) return;
    const states: Record<string, boolean> = {
      wrap: prefs.wrap,
      lineNumbers: prefs.lineNumbers,
      highlightLine: prefs.highlightLine,
      showWhitespace: prefs.showWhitespace,
      "theme.system": prefs.theme === "system",
      "theme.light": prefs.theme === "light",
      "theme.dark": prefs.theme === "dark",
      spelling: prefs.spelling && !!ac?.enabled,
      spellInternational: prefs.spellInternational,
    };
    for (const l of LANGUAGES) states[`lang.${l.id}`] = d?.lang === l.id;
    ENCODINGS.forEach((e, i) => (states[`enc.${i}`] = !!d && encodingKey(e.encoding, e.bom) === encodingKey(d.encoding, d.bom)));
    for (const e of EOLS) states[`eol.${e.id}`] = d?.eol === e.id;
    states["indent.tabs"] = !!d?.indent.tabs;
    states["indent.spaces"] = !!d && !d.indent.tabs;
    for (const w of INDENT_WIDTHS) states[`indent.w.${w}`] = d?.indent.width === w;
    m.setChecked(states);
  });

  // --- Rendu -------------------------------------------------------------------

  const pr = prefs ?? DEFAULT_PREFS;
  const st = d?.view.state;
  const head = st?.selection.main.head ?? 0;
  const line = st?.doc.lineAt(head);
  const col = line && st ? countColumn(st.sliceDoc(line.from, head), d!.indent.width || 4) + 1 : 1;
  const ranges = st?.selection.ranges ?? [];
  const selChars = ranges.reduce((n, r) => n + r.to - r.from, 0);
  const selLines = st && selChars ? ranges.reduce((n, r) => n + st.doc.lineAt(r.to).number - st.doc.lineAt(r.from).number + 1, 0) : 0;

  const popupItems = (): PopupItem[] => {
    if (!popup || !d) return [];
    switch (popup.kind) {
      case "lang":
        return LANGUAGES.map((l) => ({ id: `lang.${l.id}`, label: l.name, checked: d.lang === l.id }));
      case "enc":
        return [
          { id: "h", label: "Enregistrer avec l'encodage", header: true },
          ...ENCODINGS.map((e, i) => ({ id: `enc.${i}`, label: e.label, checked: encodingKey(e.encoding, e.bom) === encodingKey(d.encoding, d.bom) })),
          ...(d.path ? [{ id: "h2", label: "Autre", header: true }, { id: "reopen", label: "Rouvrir avec un autre encodage…" }] : []),
        ];
      case "reopen":
        return [{ id: "h", label: "Rouvrir avec l'encodage", header: true }, ...ENCODINGS.filter((e) => !(e.bom && e.encoding === "UTF-8")).map((e) => ({ id: `reopen.${ENCODINGS.indexOf(e)}`, label: e.label }))];
      case "eol":
        return EOLS.map((e) => ({ id: `eol.${e.id}`, label: e.label, checked: d.eol === e.id }));
      case "indent":
        return [
          { id: "indent.spaces", label: "Espaces", checked: !d.indent.tabs },
          { id: "indent.tabs", label: "Tabulations", checked: d.indent.tabs },
          { id: "h", label: "Largeur", header: true },
          ...INDENT_WIDTHS.map((w) => ({ id: `indent.w.${w}`, label: String(w), checked: d.indent.width === w })),
        ];
    }
  };

  const openPopup = (kind: "lang" | "enc" | "eol" | "indent", e: ReactMouseEvent<HTMLElement>) => {
    const x = e.currentTarget.getBoundingClientRect().left;
    setPopup((p) => (p?.kind === kind ? null : { kind, x }));
  };

  return (
    <div className="app">
      <div className="tabbar" role="tablist" onDoubleClick={(e) => e.target === e.currentTarget && run("new")}>
        {docs.current.map((t) => (
          <div
            key={t.id}
            role="tab"
            aria-selected={t.id === activeId}
            className={`tab ${t.id === activeId ? "active" : ""} ${isDirty(t) ? "dirty" : ""}`}
            title={t.path ?? docName(t)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                void closeDoc(t);
              }
            }}
            onClick={() => activate(t.id)}
          >
            <span className="name">{docName(t)}</span>
            <button
              className="close"
              title="Fermer (Ctrl+W)"
              aria-label={`Fermer ${docName(t)}`}
              onClick={(e) => {
                e.stopPropagation();
                void closeDoc(t);
              }}
            >
              <span className="dot">●</span>
              <span className="x">×</span>
            </button>
          </div>
        ))}
        <button className="newtab" title="Nouveau (Ctrl+N)" aria-label="Nouveau document" onClick={() => run("new")}>
          +
        </button>
      </div>
      {d?.banner && (
        <div className={`banner ${d.banner.kind}`} role="status">
          <span>{d.banner.text}</span>
          {d.banner.kind === "changed" && (
            <>
              <button onClick={() => void reload(d, undefined, false)}>Recharger</button>
              <button onClick={() => ((d.banner = null), bump())}>Ignorer</button>
            </>
          )}
          {d.banner.kind !== "changed" && (
            <button className="x" aria-label="Masquer" onClick={() => ((d.banner = null), bump())}>
              ×
            </button>
          )}
        </div>
      )}
      <div className="editors" ref={editors} />
      <div className="statusbar">
        <span className="pos">
          Ligne {line?.number ?? 1}, colonne {col}
        </span>
        {selChars > 0 && (
          <span className="sel">
            {ranges.length > 1 ? `${ranges.length} sélections, ` : ""}
            {selChars.toLocaleString("fr-CA")} caractère{selChars > 1 ? "s" : ""}
            {selLines > 1 ? ` (${selLines} lignes)` : ""}
          </span>
        )}
        {ranges.length > 1 && !selChars && <span className="sel">{ranges.length} curseurs</span>}
        <span className="spacer">{toast ?? ""}</span>
        {d?.readonly && <span className="ro">Lecture seule</span>}
        {d && d.spell !== "off" && (
          <button className="sb ac" title={`Correction du français par AuxiCorrect${ac?.version ? ` ${ac.version}` : ""} (F7 pour désactiver)`} onClick={() => run("spelling")}>
            ✓ AuxiCorrect
          </button>
        )}
        {d && (
          <>
            <button className="sb" title="Langage (coloration syntaxique)" onClick={(e) => openPopup("lang", e)}>
              {language(d.lang).name}
            </button>
            <button className="sb" title="Indentation" onClick={(e) => openPopup("indent", e)}>
              {d.indent.tabs ? "Tabulations" : "Espaces"} : {d.indent.width || pr.indentWidth}
            </button>
            <button className="sb" title="Encodage (cliquer pour changer)" onClick={(e) => openPopup("enc", e)}>
              {encodingLabel(d.encoding, d.bom)}
            </button>
            <button className="sb" title="Fins de ligne (cliquer pour changer)" onClick={(e) => openPopup("eol", e)}>
              {eolShort(d.eol)}
            </button>
            <span className={`state ${isDirty(d) ? "modified" : ""}`}>{isDirty(d) ? "Modifié" : d.path ? "Enregistré" : "Nouveau"}</span>
          </>
        )}
      </div>
      {popup && d && (
        <Popup
          key={popup.kind}
          items={popupItems()}
          x={popup.x}
          filter={popup.kind === "lang"}
          onClose={() => setPopup(null)}
          onPick={(id) => {
            if (id === "reopen") return setPopup({ kind: "reopen", x: popup.x });
            setPopup(null);
            run(id);
            d.view.focus();
          }}
        />
      )}
      {modal && (
        <Modal
          spec={modal}
          onClose={(v) => {
            const cur = modalQueue.current.shift();
            setModal(modalQueue.current[0] ?? null);
            cur?.resolve(v);
            requestAnimationFrame(() => active()?.view.focus());
          }}
        />
      )}
    </div>
  );
}

/** Colonne affichée (les tabulations comptent jusqu'au taquet suivant). */
function countColumn(s: string, tab: number): number {
  let n = 0;
  for (const ch of s) n = ch === "\t" ? n + tab - (n % tab) : n + 1;
  return n;
}
