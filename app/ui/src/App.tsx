// Fenêtre d'une application. AuxiOffice est le lanceur : il crée et ouvre
// des documents dans leur vraie application (AuxiWriter, AuxiSheet…), sans
// en ouvrir lui-même. AuxiWriter, AuxiSheet, AuxiPresent, AuxiDraw, AuxiPDF
// démarrent directement sur leur document ; chaque document a sa fenêtre
// (réglage par défaut) ou son onglet, et la barre d'onglets n'apparaît qu'à
// partir de deux documents. Sans document : l'écran de démarrage.

import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useCallback, useEffect, useRef, useState } from "react";
import { APP_DOC, APP_NAMES, TABS_CHECK, type Action, type AppAction, type AppKind, type NewKind } from "./actions";
import { DocView, type DocHandle } from "./DocView";
import { installMenus, updateMenuChecks } from "./menus";
import { PrintDialog } from "./PrintDialog";
import { AuxiCorrectDictionary, AuxiCorrectOptionsDialog } from "./AuxiCorrect";
import { appInfo, call, closeDocument, launchApp, newDocument, onLaunch, onPrefs, openDocument, openPdf, openWindow, otherWindows, prefsGet, prefsSet, recentFiles, routeFiles, takeLaunches, warmEngine, type DocInfo, type Launch, type Prefs } from "./engine";
import { PdfView } from "./PdfView";
import { Home } from "./Home";
import { askPassword, passwordError } from "./PasswordDialog";
import { besideFile, fileName, isUntitled, saveFiltersFor, withSaveExtension } from "./lok";

interface Tab {
  info: DocInfo;
  path: string;
  modified: boolean;
  lost: boolean;
}

const TYPE_FILTERS = {
  text: { name: "Textes", extensions: ["docx", "docm", "doc", "odt", "rtf", "txt", "dotx", "dotm", "ott"] },
  spreadsheet: { name: "Classeurs", extensions: ["xlsx", "xlsm", "xls", "xlsb", "ods", "csv", "xltx", "ots"] },
  presentation: { name: "Présentations", extensions: ["pptx", "pptm", "ppt", "odp", "ppsx", "potx", "otp"] },
  drawing: { name: "Dessins", extensions: ["odg", "otg", "fodg", "vsdx", "vsd", "vsdm", "vdx", "cdr", "pub", "svg"] },
  pdf: { name: "Documents PDF", extensions: ["pdf"] },
};
const ALL_FILTER = { name: "Documents pris en charge", extensions: Object.values(TYPE_FILTERS).flatMap((f) => f.extensions) };

/** Filtres d'ouverture : ceux de l'application d'abord. */
function openFilters(app: AppKind) {
  const own = APP_DOC[app];
  const types = Object.entries(TYPE_FILTERS);
  if (own === "pdf") return [TYPE_FILTERS.pdf, { name: "Tous les fichiers", extensions: ["*"] }];
  const ordered = own ? [TYPE_FILTERS[own], ALL_FILTER, ...types.filter(([k]) => k !== own).map(([, f]) => f)] : [ALL_FILTER, ...types.map(([, f]) => f)];
  // AuxiDraw ouvre aussi les PDF pour les modifier.
  if (own === "drawing") ordered.splice(1, 0, { name: "PDF (à modifier)", extensions: ["pdf"] });
  return [...ordered, { name: "Tous les fichiers", extensions: ["*"] }];
}

const APP_FOR_DOC = { text: "writer", spreadsheet: "sheet", presentation: "present", drawing: "draw" } as const;

/** Dessins que LibreOffice sait lire mais pas réécrire (Visio, CorelDRAW,
 * Publisher, SVG) : « Enregistrer » demande un emplacement en ODG. */
const DRAW_NATIVE = ["odg", "fodg", "otg"];

const SAVE_FILTERS: Record<string, { name: string; extensions: string[] }[]> = {
  text: [
    { name: "Document Word", extensions: ["docx"] },
    { name: "Document Word avec macros", extensions: ["docm"] },
    { name: "Texte OpenDocument", extensions: ["odt"] },
    { name: "Texte enrichi", extensions: ["rtf"] },
    { name: "Word 97-2003", extensions: ["doc"] },
    { name: "Texte brut", extensions: ["txt"] },
  ],
  spreadsheet: [
    { name: "Classeur Excel", extensions: ["xlsx"] },
    { name: "Classeur Excel avec macros", extensions: ["xlsm"] },
    { name: "Classeur OpenDocument", extensions: ["ods"] },
    { name: "CSV", extensions: ["csv"] },
    { name: "Excel 97-2003", extensions: ["xls"] },
  ],
  presentation: [
    { name: "Présentation PowerPoint", extensions: ["pptx"] },
    { name: "Présentation PowerPoint avec macros", extensions: ["pptm"] },
    { name: "Présentation OpenDocument", extensions: ["odp"] },
    { name: "PowerPoint 97-2003", extensions: ["ppt"] },
  ],
  drawing: [
    { name: "Dessin OpenDocument", extensions: ["odg"] },
    { name: "Dessin OpenDocument (XML à plat)", extensions: ["fodg"] },
  ],
};

export function App() {
  const [app, setApp] = useState<AppKind | null>(null);
  const appRef = useRef<AppKind>("office");
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<number>(0); // 0 = aucun document (écran de démarrage)
  const [prefs, setPrefs] = useState<Prefs>({ open_mode: "windows" });
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const [recents, setRecents] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; kind: "info" | "error" } | null>(null);
  const handles = useRef(new Map<number, DocHandle>());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const notify = useCallback((text: string, kind: "info" | "error" = "info") => {
    setToast({ text, kind });
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), kind === "error" ? 7000 : 3500);
  }, []);

  const name = APP_NAMES[app ?? "office"];

  // Titre de la fenêtre.
  useEffect(() => {
    if (!app) return;
    const t = tabs.find((x) => x.info.doc === active);
    const title = t ? `${t.modified ? "• " : ""}${isUntitled(t.path) ? "Sans titre" : fileName(t.path)} — ${name}` : name;
    void getCurrentWindow().setTitle(title);
  }, [tabs, active, app, name]);

  const openPath = useCallback(
    async (path: string): Promise<boolean> => {
      const existing = tabsRef.current.find((t) => t.path === path);
      if (existing) {
        setActive(existing.info.doc);
        return true;
      }
      setBusy(`Ouverture de ${fileName(path)}…`);
      try {
        if (appRef.current === "pdf" || (appRef.current === "office" && /\.pdf$/i.test(path))) {
          const info = await openPdf(path);
          setTabs((ts) => [...ts, { info, path, modified: false, lost: false }]);
          setActive(info.doc);
          setRecents(await recentFiles(path));
          return true;
        }
        // Document chiffré : demander le mot de passe (de nouveau s'il est faux).
        let password: string | undefined;
        let info: DocInfo | null = null;
        while (!info) {
          try {
            info = await openDocument(path, false, password);
          } catch (e) {
            const why = passwordError(e);
            if (!why) throw e;
            setBusy(null);
            const pw = await askPassword(fileName(path), why === "incorrect");
            if (pw === null) return false;
            password = pw;
            setBusy(`Ouverture de ${fileName(path)}…`);
          }
        }
        if (info.locked_by) {
          const who = `${info.locked_by.user || "un autre utilisateur"}${info.locked_by.host ? ` sur ${info.locked_by.host}` : ""}${info.locked_by.date ? ` (${info.locked_by.date})` : ""}`;
          const force = await ask(
            `Ce document est déjà ouvert par ${who}.\n\nIl est ouvert en lecture seule. Si vous êtes sûr que personne ne l'utilise (par exemple après un arrêt brutal), vous pouvez l'ouvrir en modification.`,
            { title: "Document verrouillé", kind: "warning", okLabel: "Ouvrir en modification", cancelLabel: "Lecture seule" },
          );
          if (force) {
            await closeDocument(info.doc);
            info = await openDocument(path, true, password);
          }
        }
        setTabs((ts) => [...ts, { info, path, modified: false, lost: false }]);
        setActive(info.doc);
        if (!isUntitled(path)) setRecents(await recentFiles(path));
        return true;
      } catch (e) {
        await message(`Impossible d'ouvrir « ${fileName(path)} ».\n\n${e}`, { title: APP_NAMES[appRef.current], kind: "error" });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  /** Document vierge du démarrage en cours de création. */
  const startupBlank = useRef<Promise<void> | null>(null);

  /** Ouvre des fichiers ici, ou dans leur application s'ils sont d'un autre type. */
  const openFiles = useCallback(
    async (files: string[]) => {
      if (!files.length) return;
      // Un fichier arrivé pendant la création du document vierge de démarrage
      // l'attend, puis le remplace.
      if (startupBlank.current) await startupBlank.current;
      try {
        const mine = await routeFiles(files);
        if (mine.length < files.length) notify(appRef.current === "office" ? "Ouverture dans son application…" : "Document ouvert dans son application.");
        // Une fenêtre par document : cette fenêtre prend le premier document
        // si elle n'en a pas encore, chacun des autres a sa propre fenêtre.
        // Comme Word, un document vierge encore intact est remplacé.
        const ts = tabsRef.current;
        const blank = ts.length === 1 && isUntitled(ts[0].path) && !ts[0].modified ? ts[0] : null;
        let used = ts.length > 0 && !blank;
        let openedHere = false;
        const elsewhere: string[] = [];
        for (const f of mine) {
          if (prefsRef.current.open_mode === "windows" && used && !tabsRef.current.some((t) => t.path === f)) elsewhere.push(f);
          else {
            openedHere = (await openPath(f)) || openedHere;
            used = true;
          }
        }
        if (blank && openedHere) {
          await closeDocument(blank.info.doc).catch(() => undefined);
          handles.current.delete(blank.info.doc);
          setTabs((x) => x.filter((t) => t.info.doc !== blank.info.doc));
        }
        for (const f of elsewhere) await openWindow([f]);
      } catch (e) {
        notify(`${e}`, "error");
      }
    },
    [openPath, notify],
  );

  const openDialog = useCallback(async () => {
    const path = await open({ multiple: true, filters: openFilters(appRef.current) });
    if (path) await openFiles(Array.isArray(path) ? path : [path]);
  }, [openFiles]);

  const openPdfDialog = useCallback(async () => {
    const path = await open({ multiple: true, filters: [{ name: "Documents PDF", extensions: ["pdf"] }] });
    if (path) await openFiles(Array.isArray(path) ? path : [path]);
  }, [openFiles]);

  const createNew = useCallback(
    async (kind: NewKind) => {
      try {
        if (APP_DOC[appRef.current] !== kind) {
          // Un autre type (ou AuxiOffice, le lanceur) : son application.
          await launchApp(APP_FOR_DOC[kind], [], true);
          notify(`Ouverture d'${APP_NAMES[APP_FOR_DOC[kind]]}…`);
          return;
        }
        if (prefsRef.current.open_mode === "windows" && tabsRef.current.length > 0) {
          await openWindow([], true);
          return;
        }
        await openPath(await newDocument(kind));
      } catch (e) {
        notify(`Création impossible : ${e}`, "error");
      }
    },
    [openPath, notify],
  );

  // Démarrage : quelle application, puis les lancements reçus (ligne de
  // commande, Finder, second lancement transmis par le système).
  useEffect(() => {
    let off: (() => void) | undefined;
    const handle = async () => {
      for (const l of await takeLaunches()) await runLaunch(l);
    };
    const runLaunch = async (l: Launch) => {
      await openFiles(l.files);
      const own = APP_DOC[appRef.current];
      if (l.new_doc && own && own !== "pdf" && !l.files.length) await createNew(own);
    };
    let offPrefs: (() => void) | undefined;
    void (async () => {
      const info = await appInfo();
      appRef.current = info.kind;
      const p = await prefsGet().catch(() => null);
      if (p) {
        prefsRef.current = p;
        setPrefs(p);
      }
      offPrefs = await onPrefs((np) => {
        prefsRef.current = np;
        setPrefs(np);
      });
      setApp(info.kind);
      setRecents(await recentFiles());
      off = await onLaunch(() => void handle());
      const first = await takeLaunches();
      for (const l of first) await runLaunch(l);
      // Comme Word : l'application démarre sur un document vierge, sauf si un
      // fichier arrive juste après le lancement (macOS : document du Finder
      // ou d'AuxiOffice, livré par le système après le démarrage).
      const own = APP_DOC[info.kind];
      if (!first.length && own && own !== "pdf") {
        await new Promise((r) => window.setTimeout(r, 400));
        const late = await takeLaunches();
        for (const l of late) await runLaunch(l);
        if (!late.length && tabsRef.current.length === 0) {
          const blank = createNew(own);
          startupBlank.current = blank;
          await blank;
          startupBlank.current = null;
        }
      }
      // Moteur de réserve, une fois l'interface affichée (pas dans AuxiPDF).
      if (info.kind !== "pdf") window.setTimeout(() => void warmEngine(), first.length ? 4000 : 800);
    })();
    return () => {
      off?.();
      offPrefs?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTab = (doc: number, patch: Partial<Tab>) => setTabs((ts) => ts.map((t) => (t.info.doc === doc ? { ...t, ...patch } : t)));

  /** Enregistre ; vrai si le document est enregistré (faux : annulé ou échec). */
  const saveDocument = useCallback(
    async (doc: number, asNew: boolean): Promise<boolean> => {
      const t = tabsRef.current.find((x) => x.info.doc === doc);
      if (!t) return false;
      if (t.info.type === "pdf") {
        const saved = await handles.current.get(doc)?.save?.(asNew);
        if (saved) {
          setTab(doc, { path: saved, modified: false, info: { ...t.info, path: saved, read_only: false } });
          setRecents(await recentFiles(saved));
        }
        return !!saved;
      }
      // Dessins que LibreOffice ne sait pas réécrire : enregistrés en ODG.
      const ext = t.path.split(".").pop()?.toLowerCase() ?? "";
      const foreign = t.info.type === "drawing" && !DRAW_NATIVE.includes(ext);
      try {
        if (asNew || foreign || isUntitled(t.path) || t.info.read_only) {
          // Format du document proposé d'abord (un .docm garde ses macros).
          const filters = saveFiltersFor(SAVE_FILTERS[t.info.type] ?? [], isUntitled(t.path) || foreign ? "" : t.path);
          const base = isUntitled(t.path) ? "Sans titre" : fileName(t.path).replace(/\.[^.]+$/, "");
          const name = `${base}.${filters[0]?.extensions[0] ?? "odt"}`;
          const chosen = await save({ filters, defaultPath: isUntitled(t.path) ? name : besideFile(t.path, name) });
          if (!chosen) return false;
          const target = withSaveExtension(chosen, filters);
          setBusy("Enregistrement…");
          await call(doc, "save_as_location", { path: target });
          setTab(doc, { path: target, modified: false, info: { ...t.info, read_only: false, locked_by: null, path: target } });
          setRecents(await recentFiles(target));
        } else {
          setBusy("Enregistrement…");
          await call(doc, "save_in_place");
          setTab(doc, { modified: false });
        }
        notify("Document enregistré.");
        return true;
      } catch (e) {
        await message(`L'enregistrement a échoué.\n\n${e}`, { title: APP_NAMES[appRef.current], kind: "error" });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [notify],
  );

  const exportPdf = useCallback(
    async (doc: number) => {
      const t = tabsRef.current.find((x) => x.info.doc === doc);
      if (!t) return;
      const base = isUntitled(t.path) ? "Sans titre" : fileName(t.path).replace(/\.[^.]+$/, "");
      const pdf = [{ name: "PDF", extensions: ["pdf"] }];
      const chosen = await save({ filters: pdf, defaultPath: isUntitled(t.path) ? `${base}.pdf` : besideFile(t.path, `${base}.pdf`) });
      if (!chosen) return;
      const target = withSaveExtension(chosen, pdf);
      setBusy("Exportation en PDF…");
      try {
        await call(doc, "save", { path: target, format: "pdf" });
        notify("PDF exporté.");
      } catch (e) {
        notify(`Exportation impossible : ${e}`, "error");
      } finally {
        setBusy(null);
      }
    },
    [notify],
  );

  /** AuxiDraw : copie de la page en cours en image (PNG ou SVG). */
  const exportImage = useCallback(
    async (doc: number) => {
      const t = tabsRef.current.find((x) => x.info.doc === doc);
      if (!t) return;
      const base = isUntitled(t.path) ? "Sans titre" : fileName(t.path).replace(/\.[^.]+$/, "");
      const target = await save({
        filters: [
          { name: "Image PNG", extensions: ["png"] },
          { name: "Image vectorielle SVG", extensions: ["svg"] },
        ],
        defaultPath: `${base}.png`,
      });
      if (!target) return;
      const format = target.toLowerCase().endsWith(".svg") ? "svg" : "png";
      setBusy("Exportation…");
      try {
        await call(doc, "save", { path: target, format });
        notify("Image exportée.");
      } catch (e) {
        notify(`Exportation impossible : ${e}`, "error");
      } finally {
        setBusy(null);
      }
    },
    [notify],
  );

  const closeTab = useCallback(async (doc: number) => {
    const t = tabsRef.current.find((x) => x.info.doc === doc);
    if (!t) return;
    if (t.modified && !t.lost) {
      // Enregistrer d'ici, comme dans les autres suites bureautiques.
      const choice = await message(`Les modifications de « ${isUntitled(t.path) ? "Sans titre" : fileName(t.path)} » ne sont pas enregistrées.\n\nVoulez-vous les enregistrer avant de fermer ?`, {
        title: "Fermer le document",
        kind: "warning",
        buttons: { yes: "Enregistrer", no: "Ne pas enregistrer", cancel: "Annuler" },
      });
      if (choice === "Enregistrer" || choice === "Yes") {
        if (!(await saveDocument(doc, false))) return;
      } else if (choice !== "Ne pas enregistrer" && choice !== "No") {
        return;
      }
    }
    await closeDocument(doc).catch(() => undefined);
    handles.current.delete(doc);
    const rest = tabsRef.current.filter((x) => x.info.doc !== doc);
    // Dernier document d'une fenêtre alors que d'autres sont ouvertes : la
    // fenêtre se ferme, comme dans Word. Sinon, l'écran de démarrage.
    if (!rest.length && (await otherWindows().catch(() => 0)) > 0) {
      await getCurrentWindow().destroy();
      return;
    }
    setTabs((ts) => {
      const left = ts.filter((x) => x.info.doc !== doc);
      setActive((a) => (a === doc ? (left[left.length - 1]?.info.doc ?? 0) : a));
      return left;
    });
  }, [saveDocument]);

  const toggleTabs = useCallback(async () => {
    const next: Prefs = { ...prefsRef.current, open_mode: prefsRef.current.open_mode === "tabs" ? "windows" : "tabs" };
    prefsRef.current = next;
    setPrefs(next);
    await prefsSet(next).catch((e) => notify(`Réglage non enregistré : ${e}`, "error"));
    notify(next.open_mode === "tabs" ? "Les documents s'ouvriront dans des onglets." : "Chaque document s'ouvrira dans sa propre fenêtre.");
  }, [notify]);

  const [about, setAbout] = useState(false);
  const [version, setVersion] = useState("");
  useEffect(() => {
    void getVersion().then(setVersion).catch(() => undefined);
  }, []);
  const [acOptions, setAcOptions] = useState(false);
  const [acWord, setAcWord] = useState<string | null>(null);

  /** Dictionnaire d'AuxiCorrect sur le mot sélectionné (ou sous le curseur). */
  const openDictionary = useCallback(async (doc: number) => {
    let word = "";
    if (doc) {
      try {
        const sel = await call<{ text: string }>(doc, "selection");
        word = (sel.text ?? "").trim();
        if (!word) {
          await call(doc, "uno", { command: ".uno:SelectWord" });
          word = ((await call<{ text: string }>(doc, "selection")).text ?? "").trim();
        }
      } catch {
        word = "";
      }
    }
    // Un seul mot (ou une locution courte).
    setAcWord(word.split(/\s+/).length <= 4 ? word.replace(/[.,;:!?«»"()]+/g, "").trim() : "");
  }, []);
  const [printing, setPrinting] = useState<number | null>(null);

  /** Actions de l'application ; `doc` = document concerné (0 = aucun). */
  const lastAction = useRef({ a: "", t: 0 });
  const appAction = useCallback(
    (a: AppAction, doc: number) => {
      // Un raccourci peut arriver à la fois par le menu natif et par la page :
      // ignorer le doublon immédiat.
      const now = performance.now();
      if (lastAction.current.a === a && now - lastAction.current.t < 400) return;
      lastAction.current = { a, t: now };
      switch (a) {
        case "newText":
          return void createNew("text");
        case "newSheet":
          return void createNew("spreadsheet");
        case "newSlides":
          return void createNew("presentation");
        case "newDrawing":
          return void createNew("drawing");
        case "exportImage":
          return doc ? void exportImage(doc) : undefined;
        case "open":
          return void openDialog();
        case "auxicorrectOptions":
          return setAcOptions(true);
        case "auxicorrectDictionary":
          return void openDictionary(doc);
        case "about":
          return setAbout(true);
        case "save":
          return doc ? void saveDocument(doc, false) : undefined;
        case "saveAs":
          return doc ? void saveDocument(doc, true) : undefined;
        case "exportPdf":
          return doc ? void exportPdf(doc) : undefined;
        case "print":
          return doc ? setPrinting(doc) : undefined;
        case "close":
          return doc ? void closeTab(doc) : undefined;
        case "toggleTabs":
          return void toggleTabs();
      }
    },
    [createNew, openDialog, saveDocument, exportPdf, exportImage, closeTab, openDictionary, toggleTabs],
  );

  // Coches des menus : état du document actif et réglage des onglets.
  const docStates = useRef<Record<string, string>>({});
  const showChecks = useCallback((states: Record<string, string>) => {
    docStates.current = states;
    updateMenuChecks({ ...states, [TABS_CHECK]: prefsRef.current.open_mode === "tabs" ? "true" : "false" });
  }, []);

  // Barre de menus : reconstruite quand le type du document actif change ;
  // les commandes de document vont au document actif.
  const activeRef = useRef(active);
  activeRef.current = active;
  const activeType = tabs.find((t) => t.info.doc === active)?.info.type ?? null;
  useEffect(() => {
    const run = (a: Action) => {
      const doc = activeRef.current;
      const h = doc ? handles.current.get(doc) : undefined;
      if (h) h.run(a);
      else if (a.app) appAction(a.app, 0);
    };
    if (app) void installMenus(activeType, run, app).then(() => showChecks(docStates.current), (e) => console.warn("menus", e));
  }, [activeType, appAction, app, showChecks]);
  useEffect(() => showChecks(docStates.current), [prefs, showChecks]);

  // Fermeture de la fenêtre : confirmer s'il reste des modifications.
  useEffect(() => {
    const w = getCurrentWindow();
    const un = w.onCloseRequested(async (ev) => {
      const dirty = tabsRef.current.filter((t) => t.modified && !t.lost);
      if (!dirty.length) return;
      const ok = await ask(`${dirty.length} document(s) contiennent des modifications non enregistrées. Quitter quand même ?`, {
        title: `Quitter ${APP_NAMES[appRef.current]}`,
        kind: "warning",
        okLabel: "Quitter",
        cancelLabel: "Annuler",
      });
      if (!ok) ev.preventDefault();
    });
    return () => void un.then((f) => f());
  }, []);

  // Fichiers déposés sur la fenêtre : ouverts ici ou dans leur application.
  const [dropping, setDropping] = useState(false);
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === "enter" || p.type === "over") setDropping(true);
      else if (p.type === "leave") setDropping(false);
      else if (p.type === "drop") {
        setDropping(false);
        if (p.paths.length) void openFiles(p.paths);
      }
    });
    return () => void un.then((f) => f());
  }, [openFiles]);

  // Raccourcis globaux (Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+W…) : portés par la
  // barre de menus native, qui les intercepte avant la page.

  if (!app) return <div className="app" />;

  return (
    <div className={`app app-${app}`}>
      {tabs.length >= 2 && (
        <div className="tabbar" role="tablist">
          {tabs.map((t) => (
            <div key={t.info.doc} role="tab" aria-selected={active === t.info.doc} className={`tab doc kind-${t.info.type} ${active === t.info.doc ? "active" : ""}`} onClick={() => setActive(t.info.doc)}>
              <span className="dot" />
              <span className="name">
                {t.modified ? "• " : ""}
                {isUntitled(t.path) ? "Sans titre" : fileName(t.path)}
              </span>
              <button
                className="close"
                title="Fermer (Ctrl+W)"
                onClick={(e) => {
                  e.stopPropagation();
                  void closeTab(t.info.doc);
                }}
              >
                ×
              </button>
            </div>
          ))}
          <span className="tabbar-fill" />
        </div>
      )}

      <div className="content">
        {tabs.length === 0 && (
          <Home
            app={app}
            recents={recents}
            onNew={createNew}
            onOpen={openDialog}
            onOpenPdf={() => void openPdfDialog()}
            onOpenPath={(p) => void openFiles([p])}
            onAuxiCorrect={() => setAcOptions(true)}
            tabs={prefs.open_mode === "tabs"}
            onToggleTabs={() => void toggleTabs()}
          />
        )}
        {tabs.map((t) =>
          t.lost ? (
            active === t.info.doc && (
              <div key={t.info.doc} className="lost">
                <h2>Le moteur de ce document s'est arrêté.</h2>
                <p>Les autres documents ne sont pas touchés. Les modifications non enregistrées de celui-ci sont perdues.</p>
                <button
                  onClick={() => {
                    const path = t.path;
                    setTabs((ts) => ts.filter((x) => x.info.doc !== t.info.doc));
                    void openPath(path);
                  }}
                >
                  Rouvrir le document
                </button>
              </div>
            )
          ) : t.info.type === "pdf" ? (
            <PdfView
              key={t.info.doc}
              info={t.info}
              path={t.path}
              active={active === t.info.doc}
              onModified={(m) => setTab(t.info.doc, { modified: m })}
              onMessage={notify}
              register={(h) => handles.current.set(t.info.doc, h)}
              onAppAction={(a) => appAction(a, t.info.doc)}
            />
          ) : (
            <DocView
              key={t.info.doc}
              info={t.info}
              active={active === t.info.doc}
              onModified={(m) => setTab(t.info.doc, { modified: m })}
              onEngineLost={() => setTab(t.info.doc, { lost: true })}
              onMessage={notify}
              register={(h) => handles.current.set(t.info.doc, h)}
              onAppAction={(a) => appAction(a, t.info.doc)}
              onStates={showChecks}
            />
          ),
        )}
      </div>

      {dropping && <div className="drop-zone">Déposez le fichier pour l'ouvrir</div>}
      {busy && (
        <div className="busy">
          <div className="spinner" /> {busy}
        </div>
      )}
      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
      {printing !== null && tabs.some((t) => t.info.doc === printing) && (
        <PrintDialog
          doc={printing}
          file={tabs.find((x) => x.info.doc === printing)?.info.type === "pdf" ? () => handles.current.get(printing)!.printable!() : undefined}
          title={(() => {
            const t = tabs.find((x) => x.info.doc === printing)!;
            return isUntitled(t.path) ? "Sans titre" : fileName(t.path);
          })()}
          onClose={() => setPrinting(null)}
          onMessage={notify}
        />
      )}
      {acOptions && <AuxiCorrectOptionsDialog onClose={() => setAcOptions(false)} onMessage={notify} />}
      {acWord !== null && <AuxiCorrectDictionary initialWord={acWord} onClose={() => setAcWord(null)} />}
      {about && (
        <div className="dialog-backdrop" onClick={() => setAbout(false)}>
          <div className="about" onClick={(e) => e.stopPropagation()}>
            {app === "office" ? (
              <img src="/logo-light.svg" alt="AuxiOffice" />
            ) : (
              <div className="app-title">
                <img src={`/icons/auxi${app}.svg`} alt="" />
                <span>{name}</span>
              </div>
            )}
            <p>Version {version.replace(/-beta\.?(\d+)$/, " bêta $1")} — {app === "office" ? "suite bureautique" : "de la suite AuxiOffice"}, écosystème AuxiNux.</p>
            {app === "pdf" ? (
              <p>Affichage des PDF : PDF.js de Mozilla (licence Apache 2.0).</p>
            ) : (
              <p>Comprend des logiciels libres, dont LibreOffice (MPL 2.0).</p>
            )}
            <p>© 2026 Projet AuxiNux · office.auxinux.ca</p>
            <button onClick={() => setAbout(false)}>Fermer</button>
          </div>
        </div>
      )}
    </div>
  );
}
