// AuxiPDF : vue d'un document PDF, affiché par PDF.js (pas de moteur
// LibreOffice). Barre d'outils (pages, zoom, rotation, recherche, outils
// d'annotation), panneau latéral (miniatures, signets), formulaires,
// enregistrement des annotations et des champs remplis, impression,
// mode présentation.

import { useCallback, useEffect, useRef, useState } from "react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { Action, AppAction } from "./actions";
import type { DocHandle } from "./DocView";
import { launchApp, openUrl, readPdf, writePdf, writePdfTemp, type DocInfo } from "./engine";
import { Icon } from "./icons";
import { fileName } from "./lok";
import { assetUrl, loadPdfjs, type PdfLib, type PdfViewerLib } from "./pdfjs";
import { isExternalLink, pageSizeLabel, pdfDate, sizeLabel } from "./pdfutil";

const IS_MAC = navigator.platform.toLowerCase().includes("mac");

interface Props {
  info: DocInfo;
  path: string;
  active: boolean;
  onModified: (modified: boolean) => void;
  onMessage: (text: string, kind?: "info" | "error") => void;
  register: (h: DocHandle) => void;
  onAppAction: (a: AppAction) => void;
}

type Viewer = InstanceType<PdfViewerLib["PDFViewer"]>;
type EventBus = InstanceType<PdfViewerLib["EventBus"]>;
type LinkService = InstanceType<PdfViewerLib["PDFLinkService"]>;

interface OutlineItem {
  title: string;
  dest: string | unknown[] | null;
  url: string | null;
  items: OutlineItem[];
}

const ZOOMS: [string, string][] = [
  ["auto", "Automatique"],
  ["page-actual", "Taille réelle"],
  ["page-fit", "Page entière"],
  ["page-width", "Pleine largeur"],
  ["0.5", "50 %"],
  ["0.75", "75 %"],
  ["1", "100 %"],
  ["1.25", "125 %"],
  ["1.5", "150 %"],
  ["2", "200 %"],
  ["3", "300 %"],
  ["4", "400 %"],
];

export function PdfView({ info, path, active, onModified, onMessage, register, onAppAction }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const viewRef = useRef<Viewer | null>(null);
  const busRef = useRef<EventBus | null>(null);
  const linkRef = useRef<LinkService | null>(null);
  const libRef = useRef<PdfLib | null>(null);
  const modifiedRef = useRef(false);
  const pathRef = useRef(path);
  pathRef.current = path;

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [scale, setScale] = useState(1);
  const [scaleValue, setScaleValue] = useState("auto");
  const [sidebar, setSidebar] = useState<"thumbs" | "outline" | null>(null);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [entireWord, setEntireWord] = useState(false);
  const [matches, setMatches] = useState({ current: 0, total: 0 });
  const [notFound, setNotFound] = useState(false);
  const [editMode, setEditMode] = useState(0);
  const [props, setProps] = useState<Record<string, string> | null>(null);
  const [presenting, setPresenting] = useState<number | null>(null);
  const [password, setPassword] = useState<{ retry: boolean; submit: (pw: string) => void; cancel: () => void } | null>(null);
  const [canEdit, setCanEdit] = useState(true);

  // --- Chargement ---------------------------------------------------------
  useEffect(() => {
    let alive = true;
    let destroy: (() => void) | null = null;
    void (async () => {
      try {
        const [{ lib, viewer: V }, data] = await Promise.all([loadPdfjs(), readPdf(path)]);
        if (!alive) return;
        libRef.current = lib;
        const task = lib.getDocument({
          data,
          cMapUrl: assetUrl("cmaps"),
          cMapPacked: true,
          standardFontDataUrl: assetUrl("standard_fonts"),
          wasmUrl: assetUrl("wasm"),
          iccUrl: assetUrl("iccs"),
          enableXfa: true,
        });
        destroy = () => void task.destroy();
        task.onPassword = (update: (pw: string) => void, reason: number) => {
          setPassword({
            retry: reason === lib.PasswordResponses.INCORRECT_PASSWORD,
            submit: (pw) => {
              setPassword(null);
              update(pw);
            },
            cancel: () => {
              setPassword(null);
              void task.destroy();
              setError("Ce document est protégé par un mot de passe.");
            },
          });
        };
        const pdf = await task.promise;
        if (!alive) return;
        pdfRef.current = pdf;

        const eventBus = new V.EventBus();
        const linkService = new V.PDFLinkService({ eventBus });
        const findController = new V.PDFFindController({ eventBus, linkService });
        const viewer = new V.PDFViewer({
          container: containerRef.current!,
          viewer: viewerRef.current!,
          eventBus,
          linkService,
          findController,
          annotationEditorMode: lib.AnnotationEditorType.NONE,
          enableAutoLinking: true,
          maxCanvasPixels: 2 ** 25,
        });
        linkService.setViewer(viewer);
        busRef.current = eventBus;
        viewRef.current = viewer;
        linkRef.current = linkService;

        eventBus.on("pagesinit", () => {
          viewer.currentScaleValue = "auto";
        });
        eventBus.on("pagechanging", (e: { pageNumber: number }) => {
          setPage(e.pageNumber);
          setPageInput(String(e.pageNumber));
        });
        eventBus.on("scalechanging", (e: { scale: number; presetValue?: string }) => {
          setScale(e.scale);
          setScaleValue(e.presetValue ?? String(e.scale));
        });
        eventBus.on("updatefindmatchescount", (e: { matchesCount: { current: number; total: number } }) => setMatches(e.matchesCount));
        eventBus.on("updatefindcontrolstate", (e: { state: number; matchesCount?: { current: number; total: number } }) => {
          setNotFound(e.state === 1);
          if (e.matchesCount) setMatches(e.matchesCount);
        });
        eventBus.on("annotationeditormodechanged", (e: { mode: number }) => setEditMode(e.mode));

        // Champs remplis, annotations ajoutées : document modifié.
        const storage = pdf.annotationStorage as unknown as { onSetModified: () => void; onResetModified: () => void };
        storage.onSetModified = () => {
          modifiedRef.current = true;
          onModified(true);
        };
        storage.onResetModified = () => {
          modifiedRef.current = false;
          onModified(false);
        };

        viewer.setDocument(pdf);
        linkService.setDocument(pdf);
        findController.setDocument(pdf);
        setPages(pdf.numPages);
        setSidebar(pdf.numPages > 1 ? "thumbs" : null);
        const perms = await pdf.getPermissions().catch(() => null);
        setCanEdit(!perms || perms.has(lib.PermissionFlag.MODIFY_ANNOTATIONS) || perms.has(lib.PermissionFlag.FILL_INTERACTIVE_FORMS));
        const o = (await pdf.getOutline().catch(() => null)) as OutlineItem[] | null;
        if (!alive) return;
        setOutline(o ?? []);
        setReady(true);
      } catch (e) {
        if (alive) setError(String((e as Error)?.message ?? e));
      }
    })();
    return () => {
      alive = false;
      viewRef.current?.setDocument(null as unknown as PDFDocumentProxy);
      destroy?.();
      pdfRef.current = null;
      viewRef.current = null;
    };
    // Le document est chargé une seule fois ; « Enregistrer sous » change le
    // chemin sans recharger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Navigation, zoom ----------------------------------------------------
  const goTo = useCallback((n: number) => {
    const v = viewRef.current;
    if (!v) return;
    v.currentPageNumber = Math.min(Math.max(1, n), v.pagesCount);
  }, []);

  const setZoom = useCallback((value: string | number) => {
    const v = viewRef.current;
    if (!v) return;
    if (typeof value === "number") v.currentScale = Math.min(10, Math.max(0.1, value));
    else v.currentScaleValue = value;
  }, []);

  const zoomBy = useCallback(
    (factor: number) => {
      const v = viewRef.current;
      if (v) setZoom(Math.round(v.currentScale * factor * 100) / 100);
    },
    [setZoom],
  );

  const rotate = useCallback((delta: number) => {
    const v = viewRef.current;
    if (v) v.pagesRotation = (v.pagesRotation + delta + 360) % 360;
  }, []);

  // --- Recherche -------------------------------------------------------------
  const find = useCallback(
    (type: "" | "again" | "casesensitivitychange" | "entirewordchange", previous = false, q = query, cs = caseSensitive, ew = entireWord) => {
      busRef.current?.dispatch("find", {
        source: null,
        type,
        query: q,
        caseSensitive: cs,
        entireWord: ew,
        highlightAll: true,
        findPrevious: previous,
        matchDiacritics: false,
      });
    },
    [query, caseSensitive, entireWord],
  );

  const openFind = useCallback(() => {
    setFindOpen(true);
    window.setTimeout(() => {
      findRef.current?.focus();
      findRef.current?.select();
    }, 0);
  }, []);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    busRef.current?.dispatch("findbarclose", { source: null });
    containerRef.current?.focus();
  }, []);

  // --- Annotations -----------------------------------------------------------
  const setEditor = useCallback(
    (mode: number) => {
      const v = viewRef.current;
      if (!v) return;
      if (mode && !canEdit) {
        onMessage("Ce document n'autorise pas l'ajout d'annotations.", "error");
        return;
      }
      try {
        v.annotationEditorMode = { mode };
      } catch (e) {
        onMessage(`Outil indisponible : ${e}`, "error");
      }
    },
    [canEdit, onMessage],
  );

  // --- Enregistrer, imprimer -------------------------------------------------
  const currentBytes = useCallback(async () => {
    const pdf = pdfRef.current;
    if (!pdf) throw new Error("document non chargé");
    // Valide le texte en cours de saisie dans un champ ou une annotation.
    (document.activeElement as HTMLElement | null)?.blur?.();
    return pdf.saveDocument();
  }, []);

  const save = useCallback(
    async (asNew: boolean): Promise<string | null> => {
      let target = pathRef.current;
      if (asNew || info.read_only) {
        const chosen = await saveDialog({ filters: [{ name: "Document PDF", extensions: ["pdf"] }], defaultPath: fileName(target) });
        if (!chosen) return null;
        target = /\.pdf$/i.test(chosen) ? chosen : `${chosen}.pdf`;
      } else if (!modifiedRef.current) {
        onMessage("Aucune modification à enregistrer.");
        return null;
      }
      try {
        const bytes = await currentBytes();
        await writePdf(target, bytes);
        pdfRef.current?.annotationStorage.resetModified();
        modifiedRef.current = false;
        onModified(false);
        onMessage(asNew ? "Copie enregistrée." : "Document enregistré.");
        return target;
      } catch (e) {
        onMessage(`L'enregistrement a échoué : ${e}`, "error");
        return null;
      }
    },
    [currentBytes, info.read_only, onMessage, onModified],
  );

  const printable = useCallback(async () => {
    if (!modifiedRef.current) return pathRef.current;
    return writePdfTemp(fileName(pathRef.current), await currentBytes());
  }, [currentBytes]);

  const showProperties = useCallback(async () => {
    const pdf = pdfRef.current;
    if (!pdf) return;
    const meta = await pdf.getMetadata().catch(() => null);
    const i = (meta?.info ?? {}) as Record<string, unknown>;
    const p1 = await pdf.getPage(1);
    const [, , w, h] = p1.view;
    const str = (k: string) => (typeof i[k] === "string" ? (i[k] as string) : "");
    setProps({
      Fichier: fileName(pathRef.current),
      Dossier: pathRef.current.slice(0, pathRef.current.length - fileName(pathRef.current).length),
      Taille: info.size ? sizeLabel(info.size) : "",
      Titre: str("Title"),
      Auteur: str("Author"),
      Sujet: str("Subject"),
      "Mots-clés": str("Keywords"),
      Création: pdfDate(i.CreationDate),
      Modification: pdfDate(i.ModDate),
      "Créé avec": str("Creator"),
      "Producteur PDF": str("Producer"),
      "Version PDF": str("PDFFormatVersion"),
      Pages: String(pdf.numPages),
      "Taille de page": pageSizeLabel(w, h),
      "Affichage rapide (Web)": i.IsLinearized ? "Oui" : "Non",
      Formulaire: i.IsAcroFormPresent ? "Oui" : i.IsXFAPresent ? "Oui (XFA)" : "Non",
    });
  }, [info.size]);

  const selectAll = useCallback(() => {
    const el = viewerRef.current;
    if (!el) return;
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
  }, []);

  const copy = useCallback(async () => {
    const text = window.getSelection()?.toString() ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      document.execCommand("copy");
    }
  }, []);

  // --- Commandes (menus, raccourcis) -------------------------------------
  const pdfCommand = useCallback(
    (cmd: string) => {
      const v = viewRef.current;
      const lib = libRef.current;
      switch (cmd) {
        case "find":
          return openFind();
        case "findNext":
          return query ? find("again", false) : openFind();
        case "findPrev":
          return query ? find("again", true) : openFind();
        case "selectAll":
          return selectAll();
        case "copy":
          return void copy();
        case "zoomIn":
          return zoomBy(1.2);
        case "zoomOut":
          return zoomBy(1 / 1.2);
        case "actual":
          return setZoom("page-actual");
        case "fitPage":
          return setZoom("page-fit");
        case "fitWidth":
          return setZoom("page-width");
        case "rotateLeft":
          return rotate(-90);
        case "rotateRight":
          return rotate(90);
        case "sidebar":
          return setSidebar((s) => (s ? null : "thumbs"));
        case "present":
          return setPresenting(v?.currentPageNumber ?? 1);
        case "scrollVertical":
          if (v) v.scrollMode = 0;
          return;
        case "scrollPage":
          if (v) v.scrollMode = 3;
          return;
        case "scrollWrapped":
          if (v) v.scrollMode = 2;
          return;
        case "spreadNone":
        case "spreadOdd":
        case "spreadEven":
          if (v) v.spreadMode = { spreadNone: 0, spreadOdd: 1, spreadEven: 2 }[cmd];
          return;
        case "first":
          return goTo(1);
        case "prev":
          return void v?.previousPage();
        case "next":
          return void v?.nextPage();
        case "last":
          return goTo(pages);
        case "goto": {
          const el = document.querySelector<HTMLInputElement>(`.pdfview[data-doc="${info.doc}"] .pdf-page-input`);
          el?.focus();
          el?.select();
          return;
        }
        case "editNone":
          return setEditor(0);
        case "editHighlight":
          return lib && setEditor(lib.AnnotationEditorType.HIGHLIGHT);
        case "editText":
          return lib && setEditor(lib.AnnotationEditorType.FREETEXT);
        case "editInk":
          return lib && setEditor(lib.AnnotationEditorType.INK);
        case "editStamp":
          return lib && setEditor(lib.AnnotationEditorType.STAMP);
        case "properties":
          return void showProperties();
        case "openInDraw":
          return void launchApp("draw", [pathRef.current]).then(() => onMessage("Ouverture dans AuxiDraw…"), (e) => onMessage(`${e}`, "error"));
      }
    },
    [openFind, find, query, selectAll, copy, zoomBy, setZoom, rotate, goTo, pages, info.doc, setEditor, showProperties, onMessage],
  );

  const run = useCallback(
    (a: Action) => {
      if (a.app === "pdf" && typeof a.args?.cmd === "string") pdfCommand(a.args.cmd);
      else if (a.app) onAppAction(a.app);
    },
    [pdfCommand, onAppAction],
  );

  useEffect(() => {
    register({ run, save, printable });
  }, [register, run, save, printable]);

  // Raccourcis de la page (les menus natifs portent les autres).
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (presenting !== null || password) return;
      const primary = IS_MAC ? e.metaKey : e.ctrlKey;
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.isContentEditable;
      if (primary && !e.altKey) {
        const k = e.key.toLowerCase();
        const map: Record<string, () => void> = {
          f: openFind,
          "+": () => zoomBy(1.2),
          "=": () => zoomBy(1.2),
          "-": () => zoomBy(1 / 1.2),
          "0": () => setZoom("page-actual"),
          s: () => onAppAction(e.shiftKey ? "saveAs" : "save"),
          p: () => onAppAction("print"),
          g: () => pdfCommand("goto"),
        };
        if (map[k] && !(typing && k === "a")) {
          e.preventDefault();
          map[k]();
        }
        return;
      }
      if (typing) return;
      if (e.key === "F5") {
        e.preventDefault();
        pdfCommand("present");
      } else if (e.key === "F3") {
        e.preventDefault();
        pdfCommand(e.shiftKey ? "findPrev" : "findNext");
      } else if (e.key === "Escape" && editMode) {
        setEditor(0);
      } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && viewRef.current && containerRef.current && containerRef.current.scrollWidth <= containerRef.current.clientWidth) {
        e.preventDefault();
        if (e.key === "ArrowRight") viewRef.current.nextPage();
        else viewRef.current.previousPage();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, presenting, password, editMode, openFind, zoomBy, setZoom, onAppAction, pdfCommand, setEditor]);

  // Liens externes : navigateur du système (jamais dans la fenêtre).
  const onClickCapture = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a) return;
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith("#")) return; // lien interne : PDF.js s'en charge
    e.preventDefault();
    e.stopPropagation();
    if (isExternalLink(href)) void openUrl(href).catch((err) => onMessage(`${err}`, "error"));
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    }
  };

  const lib = libRef.current;
  const modes = lib?.AnnotationEditorType;
  const scaleOptions = ZOOMS.some(([v]) => v === scaleValue) ? ZOOMS : [[scaleValue, `${Math.round(scale * 100)} %`] as [string, string], ...ZOOMS];

  return (
    <div className="pdfview docview" data-doc={info.doc} style={{ display: active ? "flex" : "none" }}>
      <div className="toolbar pdf-toolbar" role="toolbar">
        <div className="group">
          <TbBtn icon="sidebar" title="Panneau latéral (F4)" active={!!sidebar} onClick={() => setSidebar((s) => (s ? null : "thumbs"))} />
          <TbBtn icon="save" title="Enregistrer (Ctrl+S)" onClick={() => onAppAction("save")} />
          <TbBtn icon="print" title="Imprimer (Ctrl+P)" onClick={() => onAppAction("print")} />
        </div>
        <div className="group">
          <TbBtn icon="prev" title="Page précédente" disabled={page <= 1} onClick={() => viewRef.current?.previousPage()} />
          <input
            className="pdf-page-input"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const n = Number.parseInt(pageInput, 10);
                if (Number.isFinite(n)) goTo(n);
                else setPageInput(String(page));
                containerRef.current?.focus();
              }
              if (e.key === "Escape") setPageInput(String(page));
            }}
            aria-label="Numéro de page"
          />
          <span className="pdf-page-count">sur {pages || "…"}</span>
          <TbBtn icon="next" title="Page suivante" disabled={page >= pages} onClick={() => viewRef.current?.nextPage()} />
        </div>
        <div className="group">
          <TbBtn icon="zoomOut" title="Zoom arrière (Ctrl+−)" onClick={() => zoomBy(1 / 1.2)} />
          <select className="pdf-zoom" value={scaleValue} onChange={(e) => setZoom(e.target.value)} aria-label="Zoom">
            {scaleOptions.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <TbBtn icon="zoomIn" title="Zoom avant (Ctrl++)" onClick={() => zoomBy(1.2)} />
          <TbBtn icon="rotateLeft" title="Rotation à gauche" onClick={() => rotate(-90)} />
          <TbBtn icon="rotateRight" title="Rotation à droite" onClick={() => rotate(90)} />
        </div>
        {modes && (
          <div className="group">
            <TbBtn icon="pointer" title="Lecture (aucun outil)" active={editMode === 0} onClick={() => setEditor(0)} />
            <TbBtn icon="highlight" title="Surligner" active={editMode === modes.HIGHLIGHT} disabled={!canEdit} onClick={() => setEditor(editMode === modes.HIGHLIGHT ? 0 : modes.HIGHLIGHT)} />
            <TbBtn icon="textbox" title="Ajouter du texte" active={editMode === modes.FREETEXT} disabled={!canEdit} onClick={() => setEditor(editMode === modes.FREETEXT ? 0 : modes.FREETEXT)} />
            <TbBtn icon="freehand" title="Dessin à main levée" active={editMode === modes.INK} disabled={!canEdit} onClick={() => setEditor(editMode === modes.INK ? 0 : modes.INK)} />
            <TbBtn icon="image" title="Ajouter une image" active={editMode === modes.STAMP} disabled={!canEdit} onClick={() => setEditor(editMode === modes.STAMP ? 0 : modes.STAMP)} />
          </div>
        )}
        <span className="tabbar-fill" />
        <div className="group">
          <TbBtn icon="search" title="Rechercher (Ctrl+F)" active={findOpen} onClick={() => (findOpen ? closeFind() : openFind())} />
          <TbBtn icon="present" title="Mode présentation (F5)" onClick={() => pdfCommand("present")} />
        </div>
      </div>

      {findOpen && (
        <div className="pdf-findbar">
          <input
            ref={findRef}
            value={query}
            placeholder="Rechercher dans le document"
            onChange={(e) => {
              setQuery(e.target.value);
              find("", false, e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") find("again", e.shiftKey);
              if (e.key === "Escape") closeFind();
            }}
            className={notFound && query ? "not-found" : ""}
            aria-label="Texte à rechercher"
          />
          <button title="Précédent (Maj+Entrée)" onClick={() => find("again", true)}>
            <Icon name="prev" size={16} />
          </button>
          <button title="Suivant (Entrée)" onClick={() => find("again", false)}>
            <Icon name="next" size={16} />
          </button>
          <label>
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => {
                setCaseSensitive(e.target.checked);
                find("casesensitivitychange", false, query, e.target.checked);
              }}
            />
            Respecter la casse
          </label>
          <label>
            <input
              type="checkbox"
              checked={entireWord}
              onChange={(e) => {
                setEntireWord(e.target.checked);
                find("entirewordchange", false, query, caseSensitive, e.target.checked);
              }}
            />
            Mots entiers
          </label>
          <span className="muted">{query ? (notFound ? "Introuvable" : matches.total ? `${matches.current} sur ${matches.total}` : "") : ""}</span>
          <span className="spacer-flex" />
          <button title="Fermer (Échap)" onClick={closeFind}>
            ×
          </button>
        </div>
      )}

      <div className="workarea">
        {sidebar && ready && (
          <div className="pdf-sidebar">
            <div className="pdf-sidebar-tabs">
              <button className={sidebar === "thumbs" ? "active" : ""} onClick={() => setSidebar("thumbs")}>
                Pages
              </button>
              <button className={sidebar === "outline" ? "active" : ""} onClick={() => setSidebar("outline")} disabled={!outline.length} title={outline.length ? "" : "Ce document n'a pas de signets"}>
                Signets
              </button>
            </div>
            {sidebar === "thumbs" ? (
              <Thumbnails pdf={pdfRef.current!} current={page} onSelect={goTo} />
            ) : (
              <Outline items={outline} onDest={(d) => void linkRef.current?.goToDestination(d as never)} onUrl={(u) => void openUrl(u).catch(() => undefined)} />
            )}
          </div>
        )}
        <div className="pdf-area" onWheel={onWheel}>
          {error ? (
            <div className="lost">
              <h2>Impossible d'afficher ce PDF.</h2>
              <p>{error}</p>
            </div>
          ) : (
            <div ref={containerRef} className="pdf-container" tabIndex={0} onClickCapture={onClickCapture}>
              <div ref={viewerRef} className="pdfViewer" />
            </div>
          )}
          {!ready && !error && <div className="pdf-loading">Ouverture du document…</div>}
        </div>
      </div>

      <div className="statusbar">
        <span>{pages ? `Page ${page} sur ${pages}` : ""}</span>
        <span className="spacer-flex" />
        {info.read_only && <span>Lecture seule</span>}
        <span>{Math.round(scale * 100)} %</span>
      </div>

      {password && <PasswordDialog retry={password.retry} onSubmit={password.submit} onCancel={password.cancel} />}
      {props && <PropertiesDialog props={props} onClose={() => setProps(null)} />}
      {presenting !== null && pdfRef.current && (
        <PdfShow
          pdf={pdfRef.current}
          start={presenting}
          rotation={viewRef.current?.pagesRotation ?? 0}
          onClose={(last) => {
            setPresenting(null);
            goTo(last);
          }}
        />
      )}
    </div>
  );
}

function TbBtn(p: { icon: Parameters<typeof Icon>[0]["name"]; title: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button className={`tb ${p.active ? "on" : ""}`} title={p.title} aria-label={p.title} aria-pressed={p.active} disabled={p.disabled} onClick={p.onClick}>
      <Icon name={p.icon} />
    </button>
  );
}

// --- Panneau latéral ---------------------------------------------------------

function Thumbnails({ pdf, current, onSelect }: { pdf: PDFDocumentProxy; current: number; onSelect: (n: number) => void }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector(`[data-page="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);
  return (
    <div className="pdf-thumbs" ref={listRef}>
      {Array.from({ length: pdf.numPages }, (_, i) => (
        <button key={i} data-page={i + 1} className={current === i + 1 ? "active" : ""} onClick={() => onSelect(i + 1)} title={`Page ${i + 1}`}>
          <PageThumb pdf={pdf} n={i + 1} />
          <span className="num">{i + 1}</span>
        </button>
      ))}
    </div>
  );
}

/** Miniature dessinée quand elle devient visible. */
function PageThumb({ pdf, n }: { pdf: PDFDocumentProxy; n: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let task: { cancel: () => void } | null = null;
    let done = false;
    const draw = async () => {
      if (done) return;
      done = true;
      const page: PDFPageProxy = await pdf.getPage(n);
      const vp1 = page.getViewport({ scale: 1 });
      const dpr = window.devicePixelRatio || 1;
      const vp = page.getViewport({ scale: (120 / vp1.width) * dpr });
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      c.style.width = `${Math.round(vp.width / dpr)}px`;
      const t = page.render({ canvas: c, canvasContext: c.getContext("2d")!, viewport: vp });
      task = t;
      await t.promise.catch(() => undefined);
    };
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        void draw();
      }
    });
    io.observe(c);
    return () => {
      io.disconnect();
      task?.cancel();
    };
  }, [pdf, n]);
  return <canvas ref={ref} className="thumb" width={120} height={155} />;
}

function Outline({ items, onDest, onUrl }: { items: OutlineItem[]; onDest: (d: unknown) => void; onUrl: (u: string) => void }) {
  return (
    <ul className="pdf-outline">
      {items.map((it, i) => (
        <OutlineNode key={i} item={it} onDest={onDest} onUrl={onUrl} />
      ))}
    </ul>
  );
}

function OutlineNode({ item, onDest, onUrl }: { item: OutlineItem; onDest: (d: unknown) => void; onUrl: (u: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div className="row">
        {item.items.length > 0 ? (
          <button className="twisty" onClick={() => setOpen(!open)} aria-label={open ? "Replier" : "Déplier"}>
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="twisty" />
        )}
        <button className="title" onClick={() => (item.dest ? onDest(item.dest) : item.url && isExternalLink(item.url) ? onUrl(item.url) : undefined)}>
          {item.title}
        </button>
      </div>
      {open && item.items.length > 0 && <Outline items={item.items} onDest={onDest} onUrl={onUrl} />}
    </li>
  );
}

// --- Boîtes de dialogue -------------------------------------------------------

function PasswordDialog({ retry, onSubmit, onCancel }: { retry: boolean; onSubmit: (pw: string) => void; onCancel: () => void }) {
  const [pw, setPw] = useState("");
  return (
    <div className="dialog-backdrop">
      <form
        className="about pdf-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(pw);
        }}
      >
        <h3>Document protégé</h3>
        <p>{retry ? "Mot de passe incorrect. Réessayez." : "Ce document PDF est protégé par un mot de passe."}</p>
        <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Mot de passe" onKeyDown={(e) => e.key === "Escape" && onCancel()} />
        <div className="print-actions">
          <span className="spacer-flex" />
          <button type="button" className="secondary" onClick={onCancel}>
            Annuler
          </button>
          <button type="submit" className="primary">
            Ouvrir
          </button>
        </div>
      </form>
    </div>
  );
}

function PropertiesDialog({ props, onClose }: { props: Record<string, string>; onClose: () => void }) {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="about pdf-dialog" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <h3>Propriétés du document</h3>
        <table className="pdf-props">
          <tbody>
            {Object.entries(props)
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <tr key={k}>
                  <th>{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <button autoFocus onClick={onClose}>
          Fermer
        </button>
      </div>
    </div>
  );
}

// --- Mode présentation ------------------------------------------------------

function PdfShow({ pdf, start, rotation, onClose }: { pdf: PDFDocumentProxy; start: number; rotation: number; onClose: (page: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [n, setN] = useState(start);
  const nRef = useRef(n);
  nRef.current = n;

  useEffect(() => {
    const w = getCurrentWindow();
    let wasFull = false;
    void w
      .isFullscreen()
      .then((f) => {
        wasFull = f;
        if (!f) void w.setFullscreen(true);
      })
      .catch(() => {});
    return () => {
      if (!wasFull) void w.setFullscreen(false).catch(() => {});
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let task: { cancel: () => void } | null = null;
    const draw = async () => {
      const c = ref.current;
      if (!c) return;
      const page = await pdf.getPage(n);
      if (!alive) return;
      const vp1 = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
      const fit = Math.min(window.innerWidth / vp1.width, window.innerHeight / vp1.height);
      const dpr = window.devicePixelRatio || 1;
      const vp = page.getViewport({ scale: fit * dpr, rotation: (page.rotate + rotation) % 360 });
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      c.style.width = `${Math.round(vp.width / dpr)}px`;
      c.style.height = `${Math.round(vp.height / dpr)}px`;
      task?.cancel();
      const t = page.render({ canvas: c, canvasContext: c.getContext("2d")!, viewport: vp });
      task = t;
      await t.promise.catch(() => undefined);
    };
    void draw();
    const onResize = () => void draw();
    window.addEventListener("resize", onResize);
    return () => {
      alive = false;
      task?.cancel();
      window.removeEventListener("resize", onResize);
    };
  }, [pdf, n, rotation]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") onClose(nRef.current);
      else if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter", "n"].includes(e.key)) setN((x) => Math.min(pdf.numPages, x + 1));
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p"].includes(e.key)) setN((x) => Math.max(1, x - 1));
      else if (e.key === "Home") setN(1);
      else if (e.key === "End") setN(pdf.numPages);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pdf, onClose]);

  return (
    <div
      className="slideshow pdf-show"
      onClick={() => setN((x) => Math.min(pdf.numPages, x + 1))}
      onContextMenu={(e) => {
        e.preventDefault();
        setN((x) => Math.max(1, x - 1));
      }}
    >
      <canvas ref={ref} />
      <div className="show-hint">
        {n} / {pdf.numPages} — Échap pour quitter
      </div>
    </div>
  );
}
