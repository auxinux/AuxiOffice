// Fenêtre principale : onglet Accueil et un onglet par document ouvert.

import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Action, AppAction } from "./actions";
import { DocView, type DocHandle } from "./DocView";
import { installMenus, updateMenuChecks } from "./menus";
import { PrintDialog } from "./PrintDialog";
import { call, closeDocument, newDocument, openDocument, recentFiles, startupFile, warmEngine, type DocInfo } from "./engine";
import { Home } from "./Home";
import { fileName, isUntitled } from "./lok";

interface Tab {
  info: DocInfo;
  path: string;
  modified: boolean;
  lost: boolean;
}

const OPEN_FILTERS = [
  { name: "Documents pris en charge", extensions: ["docx", "doc", "odt", "rtf", "txt", "dotx", "xlsx", "xls", "ods", "csv", "xlsm", "pptx", "ppt", "odp", "ppsx", "odg"] },
  { name: "Textes", extensions: ["docx", "doc", "odt", "rtf", "txt", "dotx"] },
  { name: "Classeurs", extensions: ["xlsx", "xls", "ods", "csv", "xlsm"] },
  { name: "Présentations", extensions: ["pptx", "ppt", "odp", "ppsx"] },
  { name: "Tous les fichiers", extensions: ["*"] },
];

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
  drawing: [{ name: "Dessin OpenDocument", extensions: ["odg"] }],
};

export function App() {
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

  useEffect(() => {
    void recentFiles().then(setRecents);
    void startupFile().then((f) => {
      if (f) void openPath(f);
      // Moteur de réserve, une fois l'interface affichée.
      window.setTimeout(() => void warmEngine(), f ? 4000 : 800);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Titre de la fenêtre.
  useEffect(() => {
    const t = tabs.find((x) => x.info.doc === active);
    const title = t ? `${t.modified ? "• " : ""}${isUntitled(t.path) ? "Sans titre" : fileName(t.path)} — AuxiOffice` : "AuxiOffice";
    void getCurrentWindow().setTitle(title);
  }, [tabs, active]);

  const openPath = useCallback(
    async (path: string) => {
      const existing = tabsRef.current.find((t) => t.path === path);
      if (existing) {
        setActive(existing.info.doc);
        return;
      }
      setBusy(`Ouverture de ${fileName(path)}…`);
      try {
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
        await message(`Impossible d'ouvrir « ${fileName(path)} ».\n\n${e}`, { title: "AuxiOffice", kind: "error" });
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const openDialog = useCallback(async () => {
    const path = await open({ multiple: false, filters: OPEN_FILTERS });
    if (typeof path === "string") await openPath(path);
  }, [openPath]);

  const createNew = useCallback(
    async (kind: "text" | "spreadsheet" | "presentation") => {
      try {
        await openPath(await newDocument(kind));
      } catch (e) {
        notify(`Création impossible : ${e}`, "error");
      }
    },
    [openPath, notify],
  );

  const setTab = (doc: number, patch: Partial<Tab>) => setTabs((ts) => ts.map((t) => (t.info.doc === doc ? { ...t, ...patch } : t)));

  const saveDocument = useCallback(
    async (doc: number, asNew: boolean) => {
      const t = tabsRef.current.find((x) => x.info.doc === doc);
      if (!t) return;
      try {
        if (asNew || isUntitled(t.path) || t.info.read_only) {
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
        await message(`L'enregistrement a échoué.\n\n${e}`, { title: "AuxiOffice", kind: "error" });
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
        case "open":
          return void openDialog();
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
    [createNew, openDialog, saveDocument, exportPdf, closeTab],
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
    void installMenus(activeType, run).catch((e) => console.warn("menus", e));
  }, [activeType, appAction]);

  // Fermeture de la fenêtre : confirmer s'il reste des modifications.
  useEffect(() => {
    const w = getCurrentWindow();
    const un = w.onCloseRequested(async (ev) => {
      const dirty = tabsRef.current.filter((t) => t.modified && !t.lost);
      if (!dirty.length) return;
      const ok = await ask(`${dirty.length} document(s) contiennent des modifications non enregistrées. Quitter quand même ?`, {
        title: "Quitter AuxiOffice",
        kind: "warning",
        okLabel: "Quitter",
        cancelLabel: "Annuler",
      });
      if (!ok) ev.preventDefault();
    });
    return () => void un.then((f) => f());
  }, []);

  // Raccourcis globaux (Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+W…) : portés par la
  // barre de menus native, qui les intercepte avant la page.

  return (
    <div className="app">
      <div className="tabbar" role="tablist">
        <div role="tab" className={`tab tab-home ${active === 0 ? "active" : ""}`} onClick={() => setActive(0)} aria-selected={active === 0}>
          <img src="/logo-mark.svg" alt="" />
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

      <div className="content">
        {active === 0 && <Home recents={recents} onNew={createNew} onOpen={openDialog} onOpenPath={openPath} />}
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

      {busy && (
        <div className="busy">
          <div className="spinner" /> {busy}
        </div>
      )}
      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
      {printing !== null && tabs.some((t) => t.info.doc === printing) && (
        <PrintDialog
          doc={printing}
          title={(() => {
            const t = tabs.find((x) => x.info.doc === printing)!;
            return isUntitled(t.path) ? "Sans titre" : fileName(t.path);
          })()}
          onClose={() => setPrinting(null)}
          onMessage={notify}
        />
      )}
      {about && (
        <div className="dialog-backdrop" onClick={() => setAbout(false)}>
          <div className="about" onClick={(e) => e.stopPropagation()}>
            <img src="/logo-light.svg" alt="AuxiOffice" />
            <p>Version 0.1.0 — suite bureautique de l'écosystème AuxiNux.</p>
            <p>
              Moteur de documents : LibreOffice{tabs[0]?.info.libreoffice ? "" : ""}. LibreOffice est une marque déposée de The Document Foundation.
            </p>
            <p>© 2026 Projet AuxiNux · office.auxinux.ca</p>
            <button onClick={() => setAbout(false)}>Fermer</button>
          </div>
        </div>
      )}
    </div>
  );
}
