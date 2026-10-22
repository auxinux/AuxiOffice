// Fenêtre principale. AuxiOffice (le gestionnaire) : accueil seul, chaque
// document part dans son application. AuxiWriter, AuxiSheet, AuxiPresent,
// AuxiDraw, AuxiPDF : onglet Accueil et un onglet par document de leur type.

import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useCallback, useEffect, useRef, useState } from "react";
import { APP_DOC, APP_NAMES, type Action, type AppAction, type AppKind, type NewKind } from "./actions";
import { DocView, type DocHandle } from "./DocView";
import { installMenus, updateMenuChecks } from "./menus";
import { PrintDialog } from "./PrintDialog";
import { AuxiCorrectDictionary, AuxiCorrectOptionsDialog } from "./AuxiCorrect";
import { appInfo, call, closeDocument, launchApp, newDocument, onLaunch, openDocument, openPdf, recentFiles, routeFiles, takeLaunches, warmEngine, type DocInfo, type Launch } from "./engine";
import { PdfView } from "./PdfView";
import { Home } from "./Home";
import { fileName, isUntitled } from "./lok";

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
    { name: "Texte OpenDocument", extensions: ["odt"] },
    { name: "Texte enrichi", extensions: ["rtf"] },
    { name: "Word 97-2003", extensions: ["doc"] },
  ],
  spreadsheet: [
    { name: "Classeur Excel", extensions: ["xlsx"] },
    { name: "Classeur OpenDocument", extensions: ["ods"] },
    { name: "CSV", extensions: ["csv"] },
    { name: "Excel 97-2003", extensions: ["xls"] },
  ],
  presentation: [
    { name: "Présentation PowerPoint", extensions: ["pptx"] },
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
  const [active, setActive] = useState<number>(0); // 0 = Accueil
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
    async (path: string) => {
      const existing = tabsRef.current.find((t) => t.path === path);
      if (existing) {
        setActive(existing.info.doc);
        return;
      }
      setBusy(`Ouverture de ${fileName(path)}…`);
      try {
        if (appRef.current === "pdf") {
          const info = await openPdf(path);
          setTabs((ts) => [...ts, { info, path, modified: false, lost: false }]);
          setActive(info.doc);
          setRecents(await recentFiles(path));
          return;
        }
        let info = await openDocument(path);
        if (info.locked_by) {
          const who = `${info.locked_by.user || "un autre utilisateur"}${info.locked_by.host ? ` sur ${info.locked_by.host}` : ""}${info.locked_by.date ? ` (${info.locked_by.date})` : ""}`;
          const force = await ask(
            `Ce document est déjà ouvert par ${who}.\n\nIl est ouvert en lecture seule. Si vous êtes sûr que personne ne l'utilise (par exemple après un arrêt brutal), vous pouvez l'ouvrir en modification.`,
            { title: "Document verrouillé", kind: "warning", okLabel: "Ouvrir en modification", cancelLabel: "Lecture seule" },
          );
          if (force) {
            await closeDocument(info.doc);
            info = await openDocument(path, true);
          }
        }
        setTabs((ts) => [...ts, { info, path, modified: false, lost: false }]);
        setActive(info.doc);
        if (!isUntitled(path)) setRecents(await recentFiles(path));
      } catch (e) {
        await message(`Impossible d'ouvrir « ${fileName(path)} ».\n\n${e}`, { title: APP_NAMES[appRef.current], kind: "error" });
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  /** Ouvre des fichiers ici, ou dans leur application s'ils sont d'un autre type. */
  const openFiles = useCallback(
    async (files: string[]) => {
      if (!files.length) return;
      try {
        const mine = await routeFiles(files);
        if (mine.length < files.length) notify(appRef.current === "office" ? "Ouverture dans l'application du document…" : "Document ouvert dans son application.");
        for (const f of mine) await openPath(f);
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

  const createNew = useCallback(
    async (kind: NewKind) => {
      try {
        if (APP_DOC[appRef.current] !== kind) {
          // Un autre type : son application (AuxiOffice n'ouvre pas de document).
          await launchApp(APP_FOR_DOC[kind], [], true);
          notify(`Ouverture d'${APP_NAMES[APP_FOR_DOC[kind]]}…`);
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
    void (async () => {
      const info = await appInfo();
      appRef.current = info.kind;
      setApp(info.kind);
      setRecents(await recentFiles());
      off = await onLaunch(() => void handle());
      const first = await takeLaunches();
      for (const l of first) await runLaunch(l);
      // Moteur de réserve, une fois l'interface affichée (pas dans le gestionnaire).
      if (info.kind !== "office" && info.kind !== "pdf") window.setTimeout(() => void warmEngine(), first.length ? 4000 : 800);
    })();
    return () => off?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTab = (doc: number, patch: Partial<Tab>) => setTabs((ts) => ts.map((t) => (t.info.doc === doc ? { ...t, ...patch } : t)));

  const saveDocument = useCallback(
    async (doc: number, asNew: boolean) => {
      const t = tabsRef.current.find((x) => x.info.doc === doc);
      if (!t) return;
      if (t.info.type === "pdf") {
        const saved = await handles.current.get(doc)?.save?.(asNew);
        if (saved) {
          setTab(doc, { path: saved, modified: false, info: { ...t.info, path: saved, read_only: false } });
          setRecents(await recentFiles(saved));
        }
        return;
      }
      const ext = t.path.split(".").pop()?.toLowerCase() ?? "";
      const foreign = t.info.type === "drawing" && !DRAW_NATIVE.includes(ext);
      try {
        if (asNew || foreign || isUntitled(t.path) || t.info.read_only) {
          const filters = SAVE_FILTERS[t.info.type] ?? [];
          const base = isUntitled(t.path) ? "Sans titre" : fileName(t.path).replace(/\.[^.]+$/, "");
          const target = await save({ filters, defaultPath: `${base}.${filters[0]?.extensions[0] ?? "odt"}` });
          if (!target) return;
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
      } catch (e) {
        await message(`L'enregistrement a échoué.\n\n${e}`, { title: APP_NAMES[appRef.current], kind: "error" });
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
      const target = await save({ filters: [{ name: "PDF", extensions: ["pdf"] }], defaultPath: `${base}.pdf` });
      if (!target) return;
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
      const discard = await ask(`Les modifications de « ${isUntitled(t.path) ? "Sans titre" : fileName(t.path)} » ne sont pas enregistrées.`, {
        title: "Fermer le document",
        kind: "warning",
        okLabel: "Fermer sans enregistrer",
        cancelLabel: "Annuler",
      });
      if (!discard) return;
    }
    await closeDocument(doc).catch(() => undefined);
    handles.current.delete(doc);
    setTabs((ts) => {
      const rest = ts.filter((x) => x.info.doc !== doc);
      setActive((a) => (a === doc ? (rest[rest.length - 1]?.info.doc ?? 0) : a));
      return rest;
    });
  }, []);

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
      }
    },
    [createNew, openDialog, saveDocument, exportPdf, exportImage, closeTab, openDictionary],
  );

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
    if (app) void installMenus(activeType, run, app).catch((e) => console.warn("menus", e));
  }, [activeType, appAction, app]);

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
      {app !== "office" && (
      <div className="tabbar" role="tablist">
        <div role="tab" className={`tab tab-home ${active === 0 ? "active" : ""}`} onClick={() => setActive(0)} aria-selected={active === 0}>
          <img src={`/icons/auxi${app}.svg`} alt="" />
          <span className="name">Accueil</span>
        </div>
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
        {active !== 0 && (
          <div className="file-actions">
            <button onClick={() => void openDialog()} title="Ouvrir (Ctrl+O)">Ouvrir</button>
            <button onClick={() => void saveDocument(active, true)} title="Enregistrer sous (Ctrl+Maj+S)">Enregistrer sous</button>
          </div>
        )}
      </div>
      )}

      <div className="content">
        {active === 0 && <Home app={app} recents={recents} onNew={createNew} onOpen={openDialog} onOpenPath={(p) => void openFiles([p])} onAuxiCorrect={() => setAcOptions(true)} />}
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
              onStates={updateMenuChecks}
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
              <p>Moteur de documents : LibreOffice. LibreOffice est une marque déposée de The Document Foundation.</p>
            )}
            <p>© 2026 Projet AuxiNux · office.auxinux.ca</p>
            <button onClick={() => setAbout(false)}>Fermer</button>
          </div>
        </div>
      )}
    </div>
  );
}
