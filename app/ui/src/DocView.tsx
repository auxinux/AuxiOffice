// Vue d'un document ouvert : barre d'outils, zone d'édition par tuiles,
// éléments propres au tableur (barre de formule, en-têtes, onglets de
// feuilles) et à la présentation (panneau des diapositives).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { auxiCorrectStatus, call, onEngineEvent, paint, uno, type AuxiCorrectStatus, type DocInfo, type EngineEvent } from "./engine";
import { isCompositionInput, sameClipboardText, lokKeyFor, parseInvalidation, parseRects, parseState, toFileUrl, TWIPS_PER_PX, type Rect } from "./lok";
import { TileView } from "./TileView";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { Action, AppAction } from "./actions";
import { ContextMenu, type LoMenuItem } from "./ContextMenu";
import { DialogLayer, type DialogLayerHandle } from "./DialogLayer";
import { Icon } from "./icons";
import { SlideShow } from "./SlideShow";
import { Toolbar } from "./Toolbar";

const IS_MAC = navigator.platform.toLowerCase().includes("mac");

/** Dernière copie faite dans un document (texte de la sélection). */
let lastCopy: { doc: number; text: string } | null = null;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface DocHandle {
  /** Exécute une commande du catalogue (menus, ruban) sur ce document. */
  run: (a: Action) => void;
}

interface Props {
  info: DocInfo;
  active: boolean;
  onModified: (modified: boolean) => void;
  onEngineLost: () => void;
  onMessage: (text: string, kind?: "info" | "error") => void;
  register: (h: DocHandle) => void;
  /** Actions de l'application (enregistrer, ouvrir…), traitées par App. */
  onAppAction: (a: AppAction) => void;
  /** États des commandes (menus cochés), relayés à App. */
  onStates?: (states: Record<string, string>) => void;
}

interface Headers {
  cols: { start: number; end: number; text: string }[];
  rows: { start: number; end: number; text: string }[];
}

export function DocView({ info, active, onModified, onEngineLost, onMessage, register, onAppAction, onStates }: Props) {
  const doc = info.doc;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const viewRef = useRef<TileView | null>(null);
  const composing = useRef(false);
  const [states, setStates] = useState<Record<string, string>>({});
  const [zoom, setZoom] = useState(1);
  const [part, setPart] = useState(info.part);
  const [partNames, setPartNames] = useState(info.part_names);
  const [show, setShow] = useState<number | null>(null);
  // AuxiCorrect : état au moment de l'ouverture (il vaut pour tout le document).
  const [ac, setAc] = useState<AuxiCorrectStatus | null>(null);
  useEffect(() => {
    void auxiCorrectStatus()
      .then((s) => setAc(s.enabledForAuxiOffice ? s : null))
      .catch(() => setAc(null));
  }, []);
  const [cellAddress, setCellAddress] = useState("");
  const [formula, setFormula] = useState("");
  const [headers, setHeaders] = useState<Headers>({ cols: [], rows: [] });
  const [thumbVersion, setThumbVersion] = useState(0);
  const [pageInfo, setPageInfo] = useState("");
  const isSheet = info.type === "spreadsheet";
  const isSlides = info.type === "presentation" || info.type === "drawing";

  const dialogRef = useRef<DialogLayerHandle>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; items: LoMenuItem[] } | null>(null);
  const lastPointer = useRef({ x: 0, y: 0 });

  // Le clavier reste dans une boîte de dialogue ouverte.
  const focusInput = useCallback(() => {
    if (!dialogRef.current?.hasDialog()) inputRef.current?.focus({ preventScroll: true });
  }, []);

  // --- Tableur : zoom et zone visible à signaler au moteur, en-têtes -------
  const syncSheetViewport = useCallback(async () => {
    const v = viewRef.current;
    if (!v || !isSheet) return;
    const tt = v.tileTwips;
    await call(doc, "client_zoom", { tile_px_w: 256, tile_px_h: 256, tile_twip_w: tt, tile_twip_h: tt });
    const r = v.visibleDocRect();
    await call(doc, "visible_area", { x: r.x, y: r.y, w: r.w, h: r.h });
    const q = `.uno:ViewRowColumnHeaders?x=${r.x}&y=${r.y}&width=${r.w}&height=${r.h}`;
    const res = await call<{ values: { columns?: { size: number; text: string }[]; rows?: { size: number; text: string }[] } }>(doc, "command_values", { command: q });
    // Positions cumulées en pixels du moteur (zoom courant, pixels physiques).
    const toCss = (n: number) => n / v.dpr;
    const spans = (list: { size: number; text: string }[] | undefined) => {
      const out: Headers["cols"] = [];
      if (!list?.length) return out;
      let prev = toCss(list[0].size);
      for (const e of list.slice(1)) {
        const end = toCss(e.size);
        out.push({ start: prev, end, text: String(e.text) });
        prev = end;
      }
      return out;
    };
    setHeaders({ cols: spans(res.values.columns), rows: spans(res.values.rows) });
  }, [doc, isSheet]);

  // --- Création de la vue et abonnement aux rappels ----------------------
  useLayoutEffect(() => {
    const view = new TileView(doc, canvasRef.current!, scrollerRef.current!, spacerRef.current!, !isSheet, isSlides);
    viewRef.current = view;
    view.part = info.part;
    view.setDocSize(info.width, info.height);
    let sheetTimer = 0;
    if (isSheet) {
      view.onViewportChange = () => {
        window.clearTimeout(sheetTimer);
        sheetTimer = window.setTimeout(() => void syncSheetViewport(), 60);
      };
      void syncSheetViewport();
    }
    let thumbTimer = 0;
    const refreshInfo = async () => {
      const i = await call<DocInfo>(doc, "info");
      view.setDocSize(i.width, i.height);
      setPartNames(i.part_names);
      if (isSlides) setThumbVersion((n) => n + 1);
      updatePages(i);
    };
    const updatePages = (i: Pick<DocInfo, "pages">) => {
      if (info.type !== "text") return;
      const pages = (i.pages ?? "").split(";").filter((s) => s.trim()).map((s) => parseRects(s)[0]).filter(Boolean);
      const r = view.visibleDocRect();
      const mid = r.y + r.h / 3;
      const current = pages.findIndex((p) => mid < p.y + p.h) + 1 || pages.length;
      setPageInfo(pages.length ? `Page ${current} sur ${pages.length}` : "");
    };
    let pagesCache: DocInfo["pages"] = info.pages;
    updatePages(info);
    const onScrollPages = () => updatePages({ pages: pagesCache });
    scrollerRef.current!.addEventListener("scroll", onScrollPages, { passive: true });

    const off = onEngineEvent(doc, (ev: EngineEvent) => {
      if (ev.event === "engine_exited") {
        onEngineLost();
        return;
      }
      if (ev.event === "password_requested") {
        onMessage("Ce document est protégé par un mot de passe.", "error");
        return;
      }
      const payload = ev.payload ?? "";
      switch (ev.name) {
        case "invalidate_tiles": {
          const inv = parseInvalidation(payload);
          view.invalidate(inv.rect, inv.part);
          if (isSlides) {
            window.clearTimeout(thumbTimer);
            thumbTimer = window.setTimeout(() => setThumbVersion((n) => n + 1), 700);
          }
          break;
        }
        case "invalidate_visible_cursor": {
          let p = payload;
          if (p.startsWith("{")) p = JSON.parse(p).rectangle ?? "";
          view.overlays.cursor = parseRects(p)[0] ?? null;
          view.schedule();
          break;
        }
        case "cursor_visible":
          view.overlays.cursorVisible = payload === "true";
          view.schedule();
          break;
        case "text_selection":
          view.overlays.selection = parseRects(payload);
          view.schedule();
          break;
        case "cell_cursor":
          view.overlays.cellCursor = parseRects(payload)[0] ?? null;
          view.schedule();
          break;
        case "graphic_selection":
          view.overlays.graphic = parseRects(payload.split(",").slice(0, 4).join(","))[0] ?? null;
          view.schedule();
          break;
        case "document_size_changed":
          void refreshInfo().then(() => undefined);
          void call<DocInfo>(doc, "info").then((i) => (pagesCache = i.pages));
          break;
        case "set_part": {
          const p = Number(payload);
          if (Number.isFinite(p)) {
            view.setPart(p);
            setPart(p);
            void refreshInfo();
          }
          break;
        }
        case "state_changed": {
          const s = parseState(payload);
          if (s) {
            setStates((prev) => (prev[s.command] === s.value ? prev : { ...prev, [s.command]: s.value }));
            if (s.command === ".uno:ModifiedStatus") onModified(s.value === "true");
          }
          break;
        }
        case "cell_address":
          setCellAddress(payload);
          break;
        case "cell_formula":
          setFormula(payload);
          break;
        case "invalidate_sheet_geometry":
          void syncSheetViewport();
          break;
        case "window":
          dialogRef.current?.onWindowEvent(payload);
          break;
        case "context_menu":
          try {
            const m = JSON.parse(payload);
            if (Array.isArray(m.menu) && m.menu.length) setCtx({ ...lastPointer.current, items: m.menu });
          } catch {
            /* menu illisible : ignoré */
          }
          break;
        case "error":
          try {
            const e = JSON.parse(payload);
            onMessage(e.message || "Erreur du moteur", "error");
          } catch {
            onMessage(payload, "error");
          }
          break;
      }
    });
    return () => {
      off();
      window.clearTimeout(sheetTimer);
      window.clearTimeout(thumbTimer);
      view.dispose();
      viewRef.current = null;
    };
    // La vue est liée au document ; les autres dépendances sont stables.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  useEffect(() => {
    if (active) {
      viewRef.current?.schedule();
      focusInput();
    }
  }, [active, focusInput]);

  // --- Zoom ---------------------------------------------------------------
  const applyZoom = useCallback(
    (z: number) => {
      const v = viewRef.current;
      if (!v) return;
      v.setZoom(Math.round(z * 100) / 100);
      setZoom(v.zoom);
      if (isSheet) void syncSheetViewport();
    },
    [isSheet, syncSheetViewport],
  );

  const fitWidth = useCallback(() => {
    const v = viewRef.current;
    if (!v || !scrollerRef.current) return;
    const avail = scrollerRef.current.clientWidth - 48;
    applyZoom((avail / (v.docW / TWIPS_PER_PX)));
  }, [applyZoom]);

  useEffect(() => {
    // Présentations : afficher la diapositive entière au départ.
    if (isSlides && scrollerRef.current && viewRef.current) {
      const s = scrollerRef.current;
      const v = viewRef.current;
      const z = Math.min((s.clientWidth - 48) / (v.docW / TWIPS_PER_PX), (s.clientHeight - 48) / (v.docH / TWIPS_PER_PX));
      if (z > 0) applyZoom(Math.min(z, 2));
    }
  }, [isSlides, applyZoom]);

  // --- Souris -------------------------------------------------------------
  const lastClick = useRef({ t: 0, x: 0, y: 0, n: 0 });
  const mouse = (kind: "down" | "up" | "move", e: React.PointerEvent) => {
    const v = viewRef.current;
    if (!v) return;
    const box = scrollerRef.current!.getBoundingClientRect();
    const { x, y } = v.clientToDoc(e.clientX - box.left, e.clientY - box.top);
    if (kind === "move" && e.buttons === 0) return;
    if (kind === "down") {
      lastPointer.current = { x: e.clientX, y: e.clientY };
      setCtx(null);
      const lc = lastClick.current;
      const near = Math.abs(lc.x - e.clientX) < 4 && Math.abs(lc.y - e.clientY) < 4;
      lc.n = near && e.timeStamp - lc.t < 400 ? Math.min(lc.n + 1, 3) : 1;
      Object.assign(lc, { t: e.timeStamp, x: e.clientX, y: e.clientY });
      scrollerRef.current!.setPointerCapture(e.pointerId);
    }
    const buttons = e.button === 2 || e.buttons === 2 ? 4 : e.button === 1 ? 2 : 1;
    let mods = 0;
    if (e.shiftKey) mods |= 0x1000;
    if (IS_MAC ? e.metaKey : e.ctrlKey) mods |= 0x2000;
    if (e.altKey) mods |= 0x4000;
    void call(doc, "mouse", { kind, x, y, count: lastClick.current.n, buttons, mods });
    if (kind === "up") focusInput();
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      applyZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    }
  };

  // --- Clavier et saisie --------------------------------------------------
  const sendKey = (char: number, code: number) => {
    void call(doc, "key", { char, code }).then(() => call(doc, "key", { kind: "up", char, code }));
    window.setTimeout(() => viewRef.current?.revealCursor(), 60);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (composing.current || e.nativeEvent.isComposing) return;
    const primary = IS_MAC ? e.metaKey : e.ctrlKey;
    if (isSlides && e.key === "F5" && !primary && !e.altKey) {
      e.preventDefault();
      startShow(e.shiftKey ? part : 0);
      return;
    }
    // Raccourcis gérés par l'application ou le presse-papiers natif.
    if (primary && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        onAppAction(e.shiftKey ? "saveAs" : "save");
        return;
      }
      if (k === "c" || k === "x" || k === "v") return; // événements copy/cut/paste
      if (k === "p") {
        e.preventDefault();
        onAppAction("print");
        return;
      }
      if (k === "+" || k === "=") {
        e.preventDefault();
        applyZoom(zoom * 1.1);
        return;
      }
      if (k === "-") {
        e.preventDefault();
        applyZoom(zoom / 1.1);
        return;
      }
      if (k === "0") {
        e.preventDefault();
        applyZoom(1);
        return;
      }
    }
    const lk = lokKeyFor(e.nativeEvent, IS_MAC);
    if (lk) {
      e.preventDefault();
      sendKey(lk.char, lk.code);
    }
  };

  const onInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    // Texte composé (touches mortes, méthodes de saisie) : envoyé par compositionend.
    if (composing.current || isCompositionInput(e.nativeEvent as InputEvent)) return;
    const t = e.currentTarget.value;
    e.currentTarget.value = "";
    if (t) {
      void call(doc, "text", { text: t.replace(/\r?\n/g, "") });
      window.setTimeout(() => viewRef.current?.revealCursor(), 60);
    }
  };

  const onCompositionUpdate = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    composing.current = true;
    void call(doc, "text", { kind: "preedit", text: e.data });
  };

  const onCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    composing.current = false;
    e.currentTarget.value = "";
    void call(doc, "text", { text: e.data });
  };

  // Linux : le raccourci du menu natif (Couper, Copier, Coller) et le clavier
  // envoient chacun l'événement ; une coupe supprimait un caractère de trop.
  const lastClipboardEvent = useRef({ type: "", t: -1e9 });
  const repeated = (e: React.ClipboardEvent) => {
    const last = lastClipboardEvent.current;
    const again = last.type === e.type && e.timeStamp - last.t < 300;
    lastClipboardEvent.current = { type: e.type, t: e.timeStamp };
    return again;
  };

  const onCopy = (e: React.ClipboardEvent, cut: boolean) => {
    e.preventDefault();
    if (repeated(e)) return;
    const sel = (async () => {
      const html = await call<{ text: string | null }>(doc, "selection", { mime: "text/html" });
      const text = await call<{ text: string | null }>(doc, "selection", { mime: "text/plain;charset=utf-8" });
      lastCopy = { doc, text: text.text ?? "" };
      // Aussi dans le presse-papiers de LibreOffice, pour un collage fidèle
      // dans ce document ; Couper retire la sélection.
      await uno(doc, cut ? ".uno:Cut" : ".uno:Copy");
      return { html: html.text ?? "", text: text.text ?? "" };
    })();
    const failed = () => onMessage("Impossible d'accéder au presse-papiers.", "error");
    if (typeof ClipboardItem !== "undefined") {
      // Écriture demandée pendant l'événement (geste de l'utilisateur), son
      // contenu arrive ensuite : passé ce délai, WebKit la refusait parfois.
      const blob = (type: string, f: (s: { html: string; text: string }) => string) => sel.then((s) => new Blob([f(s)], { type }));
      navigator.clipboard
        .write([new ClipboardItem({ "text/html": blob("text/html", (s) => s.html || escapeHtml(s.text)), "text/plain": blob("text/plain", (s) => s.text) })])
        .catch(failed);
    } else {
      sel.then((s) => navigator.clipboard.writeText(s.text)).catch(failed);
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    if (repeated(e)) return;
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    // Copie faite dans ce document : presse-papiers de LibreOffice (styles,
    // formules, images et formes conservés).
    if (lastCopy?.doc === doc && sameClipboardText(text, lastCopy.text)) {
      void uno(doc, ".uno:Paste");
      return;
    }
    if (html) void call(doc, "paste", { mime: "text/html", data: html });
    else if (text) void call(doc, "paste", { mime: "text/plain;charset=utf-8", data: text });
  };

  // --- Parties : feuilles, diapositives ------------------------------------
  const goPart = async (p: number) => {
    await call(doc, "set_part", { part: p });
    viewRef.current?.setPart(p);
    setPart(p);
    const i = await call<DocInfo>(doc, "info");
    viewRef.current?.setDocSize(i.width, i.height);
    scrollerRef.current?.scrollTo(0, 0);
    if (isSheet) void syncSheetViewport();
    focusInput();
  };

  const command = useCallback(
    (cmd: string, args?: Record<string, unknown>) => {
      void uno(doc, cmd, args);
      focusInput();
    },
    [doc, focusInput],
  );

  const insertImage = useCallback(async () => {
    const path = await openDialog({ multiple: false, filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "tif", "tiff"] }] });
    if (typeof path === "string") command(".uno:InsertGraphic", { FileName: { type: "string", value: toFileUrl(path) } });
  }, [command]);

  // Diaporama : la vérification orthographique en direct est suspendue pour
  // ne pas montrer ses soulignements à l'écran.
  const spellWasOn = useRef(false);
  const startShow = useCallback(
    (from: number) => {
      spellWasOn.current = states[".uno:SpellOnline"] === "true";
      if (spellWasOn.current) void uno(doc, ".uno:SpellOnline");
      setShow(from);
    },
    [doc, states],
  );
  const endShow = useCallback(() => {
    if (spellWasOn.current) void uno(doc, ".uno:SpellOnline");
    spellWasOn.current = false;
    setShow(null);
  }, [doc]);

  const runAction = useCallback(
    (a: Action) => {
      if (a.uno) {
        command(a.uno, a.args);
        return;
      }
      const z = viewRef.current?.zoom ?? 1;
      switch (a.app) {
        case "zoomIn":
          applyZoom(z * 1.1);
          break;
        case "zoomOut":
          applyZoom(z / 1.1);
          break;
        case "zoom100":
          applyZoom(1);
          break;
        case "fitWidth":
          fitWidth();
          break;
        case "insertImage":
          void insertImage();
          break;
        case "selectAll":
          command(".uno:SelectAll");
          break;
        case "slideShow":
        case "slideShowHere":
          if (isSlides) startShow(a.app === "slideShow" ? 0 : part);
          break;
        default:
          if (a.app) onAppAction(a.app);
      }
    },
    [command, applyZoom, fitWidth, insertImage, onAppAction, isSlides, part, startShow],
  );

  useEffect(() => {
    register({ run: runAction });
  }, [register, runAction]);
  useEffect(() => {
    if (active) onStates?.(states);
  }, [active, states, onStates]);

  const v = viewRef.current;
  const originX = v?.origin.x ?? 0;
  const scrollLeft = scrollerRef.current?.scrollLeft ?? 0;
  const scrollTop = scrollerRef.current?.scrollTop ?? 0;

  return (
    <div className={`docview type-${info.type}`} style={{ display: active ? "flex" : "none" }}>
      <Toolbar type={info.type} doc={doc} states={states} command={command} run={runAction} />
      {show !== null && (
        <SlideShow
          doc={doc}
          count={partNames.length}
          start={show}
          width={info.width}
          height={info.height}
          onClose={() => {
            endShow();
            focusInput();
          }}
        />
      )}
      {info.read_only && (
        <div className="banner">
          Lecture seule{info.locked_by ? ` — document ouvert par ${info.locked_by.user || "un autre utilisateur"}${info.locked_by.host ? ` (${info.locked_by.host})` : ""}` : ""}.
          Utilisez « Enregistrer sous » pour garder vos modifications.
        </div>
      )}
      {isSheet && (
        <div className="formula-bar">
          <input
            className="namebox"
            value={cellAddress}
            onChange={(e) => setCellAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") command(".uno:GoToCell", { ToPoint: { type: "string", value: cellAddress } });
            }}
            aria-label="Cellule"
          />
          <span className="fx">ƒx</span>
          <input
            className="formula"
            value={formula}
            onChange={(e) => setFormula(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") command(".uno:EnterString", { StringName: { type: "string", value: formula } });
              if (e.key === "Escape") focusInput();
            }}
            aria-label="Contenu de la cellule"
          />
        </div>
      )}
      <div className="workarea">
        {isSlides && (
          <SlidePanel doc={doc} names={partNames} current={part} version={thumbVersion} width={info.width} height={info.height} onSelect={goPart} />
        )}
        <div className="editor">
          {isSheet && (
            <>
              <div className="corner" />
              <div className="col-headers">
                {headers.cols.map((c) => (
                  <div key={c.text} style={{ left: c.start - scrollLeft + originX, width: c.end - c.start }}>
                    {c.text}
                  </div>
                ))}
              </div>
              <div className="row-headers">
                {headers.rows.map((r) => (
                  <div key={r.text} style={{ top: r.start - scrollTop, height: r.end - r.start }}>
                    {r.text}
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="canvas-area">
            <canvas ref={canvasRef} className="doc-canvas" />
            <div
              ref={scrollerRef}
              className="scroller"
              onPointerDown={(e) => mouse("down", e)}
              onPointerMove={(e) => mouse("move", e)}
              onPointerUp={(e) => mouse("up", e)}
              onWheel={onWheel}
              onContextMenu={(e) => e.preventDefault()}
              onScroll={() => isSheet && setHeaders((h) => ({ ...h }))}
            >
              <div ref={spacerRef} className="spacer" />
            </div>
            <textarea
              ref={inputRef}
              className="ime"
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              onKeyDown={onKeyDown}
              onInput={onInput}
              onCompositionStart={() => (composing.current = true)}
              onCompositionUpdate={onCompositionUpdate}
              onCompositionEnd={onCompositionEnd}
              onCopy={(e) => onCopy(e, false)}
              onCut={(e) => onCopy(e, true)}
              onPaste={onPaste}
              aria-label="Zone d'édition du document"
            />
          </div>
        </div>
      </div>
      {isSheet && (
        <div className="sheet-tabs">
          {partNames.map((n, i) => (
            <button key={i} className={i === part ? "active" : ""} onClick={() => void goPart(i)}>
              {n}
            </button>
          ))}
        </div>
      )}
      <DialogLayer ref={dialogRef} doc={doc} onClosed={focusInput} />
      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          items={ctx.items}
          onClose={() => setCtx(null)}
          onCommand={(c) => {
            setCtx(null);
            command(c);
          }}
        />
      )}
      <div className="statusbar">
        <span>{pageInfo || (isSlides ? `Diapositive ${part + 1} sur ${partNames.length}` : isSheet ? partNames[part] : "")}</span>
        <span className="spacer-flex" />
        {ac && info.type === "text" && (
          <button className={`ac-badge ${ac.active ? "" : "off"}`} title="Options d'AuxiCorrect" onClick={() => onAppAction("auxicorrectOptions")}>
            {ac.active ? "✓ AuxiCorrect" : "AuxiCorrect désactivé"}
          </button>
        )}
        <span>{states[".uno:LanguageStatus"]?.split(";")[0] ?? ""}</span>
        <span>{states[".uno:StateWordCount"] ?? ""}</span>
        <span className="zoombox">
          <button title="Zoom arrière (Ctrl+−)" onClick={() => applyZoom(zoom / 1.1)}>
            <Icon name="zoomOut" size={16} />
          </button>
          <input
            type="range"
            min={25}
            max={400}
            value={Math.round(zoom * 100)}
            onChange={(e) => applyZoom(Number(e.target.value) / 100)}
            aria-label="Zoom"
          />
          <button title="Zoom avant (Ctrl++)" onClick={() => applyZoom(zoom * 1.1)}>
            <Icon name="zoomIn" size={16} />
          </button>
          <button className="zoomval" title="Zoom 100 % (Ctrl+0)" onClick={() => applyZoom(1)}>
            {Math.round(zoom * 100)} %
          </button>
          {!isSheet && (
            <button title="Ajuster à la largeur" onClick={fitWidth}>
              <Icon name="fit" size={16} />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

function SlidePanel(props: { doc: number; names: string[]; current: number; version: number; width: number; height: number; onSelect: (p: number) => void }) {
  return (
    <div className="slide-panel">
      {props.names.map((n, i) => (
        <button key={i} className={i === props.current ? "active" : ""} onClick={() => props.onSelect(i)} title={n}>
          <span className="num">{i + 1}</span>
          <Thumb doc={props.doc} part={i} version={props.version} width={props.width} height={props.height} />
        </button>
      ))}
    </div>
  );
}

function Thumb({ doc, part, version, width, height }: { doc: number; part: number; version: number; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    const pw = 320;
    const ph = Math.max(1, Math.round((pw * height) / Math.max(1, width)));
    void paint(doc, { px_w: pw, px_h: ph, x: 0, y: 0, w: width, h: height, part }).then((px) => {
      const c = ref.current;
      if (!alive || !c) return;
      c.width = pw;
      c.height = ph;
      c.getContext("2d")!.putImageData(new ImageData(px, pw, ph), 0, 0);
    });
    return () => {
      alive = false;
    };
  }, [doc, part, version, width, height]);
  return <canvas ref={ref} className="thumb" />;
}

export type { Rect };
