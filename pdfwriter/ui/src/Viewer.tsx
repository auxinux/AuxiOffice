// Affichage du document (PDF.js) et, par-dessus chaque page, les objets ajoutés,
// le texte modifiable et les outils de dessin. Le calque est un voisin de la
// visionneuse : PDF.js efface le contenu de ses pages quand il les recycle.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type PointerEvent as RPE } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { core, CoreCallError } from "./core/client";
import { type Align, LINE_HEIGHT, type PageObject, type TextObj, wrapLines } from "./core/objects";
import type { Rgb } from "./core/pages";
import type { RunEdit, TextRun } from "./core/textedit";
import { Icon } from "./icons";
import { newId } from "./model";
import { documentOptions, loadPdfjs, type PdfLib, type PdfViewerLib } from "./pdfjs";

export type Tool = "select" | "editText" | "text" | "rect" | "ellipse" | "line" | "highlight" | "whiteout";

type PdfViewer = InstanceType<PdfViewerLib["PDFViewer"]>;
type EventBus = InstanceType<PdfViewerLib["EventBus"]>;
type Viewport = { scale: number; rotation: number; convertToViewportPoint(x: number, y: number): number[]; convertToPdfPoint(x: number, y: number): number[] };

export interface ViewerHandle {
  goTo(n: number): void;
  zoom(v: string | number): void;
  zoomBy(f: number): void;
  find(type: "" | "again" | "casesensitivitychange" | "entirewordchange", q: string, previous: boolean, cs: boolean): void;
  closeFind(): void;
  /** Champs remplis repris dans les octets ; les mêmes octets s'il n'y a rien. */
  commitForms(base: Uint8Array): Promise<Uint8Array>;
  centerOf(page: number): { x: number; y: number; angle: number; w: number; h: number } | null;
  goToDest(dest: string | unknown[]): void;
}

interface Props {
  bytes: Uint8Array;
  password?: string;
  uids: string[];
  objects: Record<string, PageObject[]>;
  tool: Tool;
  selected: string | null;
  style: ToolStyle;
  readOnly: boolean;
  onReady(pdf: PDFDocumentProxy, lib: PdfLib): void;
  onError(message: string): void;
  onPage(n: number): void;
  onScale(scale: number, preset: string): void;
  onFormDirty(): void;
  onFind(info: { current: number; total: number; notFound: boolean }): void;
  onSelect(id: string | null, uid: string | null): void;
  onChangeObject(uid: string, o: PageObject, label: string): void;
  onAddObject(uid: string, o: PageObject, label: string): void;
  onRemoveObject(uid: string, id: string): void;
  onToolDone(): void;
  onEditRun(pageIndex: number, run: TextRun, edit: RunEdit): Promise<void>;
  onLink(href: string): void;
}

export interface ToolStyle {
  color: Rgb;
  fill: Rgb | null;
  strokeWidth: number;
  opacity: number;
  highlight: Rgb;
  family: TextObj["family"];
  size: number;
  bold: boolean;
  italic: boolean;
  align: Align;
}

export const css = (c: Rgb) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;
export const FONT_STACK = {
  Helvetica: '"Liberation Sans", Arimo, Arial, Helvetica, sans-serif',
  Times: '"Liberation Serif", Tinos, "Times New Roman", Times, serif',
  Courier: '"Liberation Mono", Cousine, "Courier New", Courier, monospace',
};

interface PageBox {
  index: number;
  uid: string;
  left: number;
  top: number;
  width: number;
  height: number;
  vp: Viewport;
}

export const Viewer = forwardRef<ViewerHandle, Props>(function Viewer(p, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const v = useRef<{ viewer: PdfViewer; bus: EventBus } | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const formsDirty = useRef(false);
  const scaleRef = useRef<string | number>("auto");
  const scrollRef = useRef<number | null>(null);
  const lastSize = useRef("");
  const cb = useRef(p);
  cb.current = p;
  const [boxes, setBoxes] = useState<PageBox[]>([]);
  const uidsRef = useRef(p.uids);
  uidsRef.current = p.uids;

  const measure = useCallback(() => {
    const s = v.current;
    const c = containerRef.current;
    if (!s || !c || !pdfRef.current) return;
    const out: PageBox[] = [];
    const root = overlayRef.current!.getBoundingClientRect();
    const view = c.getBoundingClientRect();
    for (let i = 0; i < s.viewer.pagesCount; i++) {
      const pv = s.viewer.getPageView(i) as { div: HTMLElement; viewport: Viewport } | undefined;
      if (!pv?.div || !uidsRef.current[i]) continue;
      const d = pv.div;
      const r = d.getBoundingClientRect();
      if (r.bottom < view.top - view.height || r.top > view.bottom + view.height) continue;
      out.push({ index: i, uid: uidsRef.current[i], left: r.left + d.clientLeft - root.left, top: r.top + d.clientTop - root.top, width: d.clientWidth, height: d.clientHeight, vp: pv.viewport });
    }
    setBoxes(out);
  }, []);

  // Création de la visionneuse (une seule) et chargement de chaque version.
  useEffect(() => {
    let alive = true;
    let task: { destroy(): Promise<void> | void; promise: Promise<PDFDocumentProxy>; onPassword?: unknown } | null = null;
    void (async () => {
      try {
        const { lib, viewer: V } = await loadPdfjs();
        if (!alive) return;
        if (!v.current) {
          const bus = new V.EventBus();
          const linkService = new V.PDFLinkService({ eventBus: bus });
          const findController = new V.PDFFindController({ eventBus: bus, linkService });
          const viewer = new V.PDFViewer({
            container: containerRef.current!,
            viewer: viewerRef.current!,
            eventBus: bus,
            linkService,
            findController,
            annotationEditorMode: lib.AnnotationEditorType.DISABLE,
            enableAutoLinking: true,
            maxCanvasPixels: 2 ** 25,
          });
          linkService.setViewer(viewer);
          linkService.externalLinkEnabled = true;
          v.current = { viewer, bus };
          (v.current as unknown as { link: typeof linkService; find: typeof findController }).link = linkService;
          (v.current as unknown as { link: typeof linkService; find: typeof findController }).find = findController;
          bus.on("pagesinit", () => {
            const sc = scaleRef.current;
            if (typeof sc === "number") viewer.currentScale = sc;
            else viewer.currentScaleValue = sc;
            if (scrollRef.current !== null) containerRef.current!.scrollTop = scrollRef.current;
            scrollRef.current = null;
            measure();
          });
          bus.on("pagechanging", (e: { pageNumber: number }) => cb.current.onPage(e.pageNumber));
          bus.on("scalechanging", (e: { scale: number; presetValue?: string }) => {
            scaleRef.current = e.presetValue ?? e.scale;
            cb.current.onScale(e.scale, e.presetValue ?? String(e.scale));
            requestAnimationFrame(measure);
          });
          bus.on("updateviewarea", measure);
          bus.on("pagerendered", measure);
          bus.on("updatefindmatchescount", (e: { matchesCount: { current: number; total: number } }) => cb.current.onFind({ ...e.matchesCount, notFound: false }));
          bus.on("updatefindcontrolstate", (e: { state: number; matchesCount?: { current: number; total: number } }) =>
            cb.current.onFind({ current: e.matchesCount?.current ?? 0, total: e.matchesCount?.total ?? 0, notFound: e.state === 1 }),
          );
        }
        const t = lib.getDocument(documentOptions(p.bytes, p.password));
        task = t as never;
        const pdf = await t.promise;
        if (!alive) {
          void t.destroy();
          return;
        }
        const previous = pdfRef.current;
        if (previous) scrollRef.current = containerRef.current!.scrollTop;
        pdfRef.current = pdf;
        formsDirty.current = false;
        const storage = pdf.annotationStorage as unknown as { onSetModified: () => void };
        storage.onSetModified = () => {
          formsDirty.current = true;
          cb.current.onFormDirty();
        };
        const s = v.current as unknown as { viewer: PdfViewer; link: InstanceType<PdfViewerLib["PDFLinkService"]>; find: InstanceType<PdfViewerLib["PDFFindController"]> };
        s.viewer.setDocument(pdf);
        s.link.setDocument(pdf);
        s.find.setDocument(pdf);
        if (previous) void (previous as unknown as { loadingTask: { destroy(): void } }).loadingTask.destroy();
        cb.current.onReady(pdf, lib);
      } catch (e) {
        if (alive) cb.current.onError(String((e as Error)?.message ?? e));
      }
    })();
    return () => {
      alive = false;
      void task;
    };
    // Une nouvelle version des octets recharge le document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.bytes, p.password]);

  useEffect(() => {
    measure();
  }, [p.uids, measure]);

  useEffect(() => {
    const c = containerRef.current!;
    const ro = new ResizeObserver(() => {
      const s = v.current;
      const size = `${c.clientWidth}x${c.clientHeight}`;
      if (s && typeof scaleRef.current === "string" && size !== lastSize.current) s.viewer.currentScaleValue = scaleRef.current;
      lastSize.current = size;
      measure();
    });
    ro.observe(c);
    ro.observe(viewerRef.current!);
    const onScroll = () => requestAnimationFrame(measure);
    c.addEventListener("scroll", onScroll, { passive: true });
    // Liens externes d'un PDF : le navigateur du système.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || !viewerRef.current?.contains(a)) return;
      const href = a.getAttribute("href") ?? "";
      if (/^(https?:|mailto:)/i.test(href)) {
        e.preventDefault();
        cb.current.onLink(href);
      }
    };
    c.addEventListener("click", onClick, true);
    return () => {
      ro.disconnect();
      c.removeEventListener("scroll", onScroll);
      c.removeEventListener("click", onClick, true);
    };
  }, [measure]);

  useImperativeHandle(ref, () => ({
    goTo: (n) => {
      if (v.current) v.current.viewer.currentPageNumber = Math.max(1, Math.min(n, v.current.viewer.pagesCount));
    },
    zoom: (value) => {
      const s = v.current;
      if (!s) return;
      if (typeof value === "number") s.viewer.currentScale = Math.min(8, Math.max(0.1, value));
      else s.viewer.currentScaleValue = value;
    },
    zoomBy: (f) => {
      const s = v.current;
      if (s) s.viewer.currentScale = Math.min(8, Math.max(0.1, Math.round(s.viewer.currentScale * f * 100) / 100));
    },
    find: (type, q, previous, cs) => {
      v.current?.bus.dispatch("find", { source: null, type, query: q, caseSensitive: cs, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false });
    },
    closeFind: () => v.current?.bus.dispatch("findbarclose", { source: null }),
    commitForms: async (base) => {
      const pdf = pdfRef.current;
      if (!pdf || !formsDirty.current) return base;
      return pdf.saveDocument();
    },
    centerOf: (page) => {
      const pv = v.current?.viewer.getPageView(page) as { viewport: Viewport; div: HTMLElement } | undefined;
      const c = containerRef.current;
      if (!pv || !c) return null;
      const vp = pv.viewport as Viewport & { width: number; height: number };
      // Centre de la partie visible de la page.
      const r = pv.div.getBoundingClientRect();
      const view = c.getBoundingClientRect();
      const px = (Math.max(r.left, view.left) + Math.min(r.right, view.right)) / 2 - r.left - pv.div.clientLeft;
      const py = (Math.max(r.top, view.top) + Math.min(r.bottom, view.bottom)) / 2 - r.top - pv.div.clientTop;
      const [x, y] = vp.convertToPdfPoint(px, py);
      return { x, y, angle: vp.rotation, w: vp.width / vp.scale, h: vp.height / vp.scale };
    },
    goToDest: (dest) => {
      const s = v.current as unknown as { link?: { goToDestination(d: unknown): void } } | null;
      void s?.link?.goToDestination(dest);
    },
  }), []);

  return (
    <div className={`viewer-host tool-${p.tool}`}>
      <div ref={containerRef} className="pdf-container" tabIndex={0}>
        <div ref={viewerRef} className="pdfViewer" />
        <div ref={overlayRef} className="overlay-root">
          {boxes.map((b) => (
            <PageLayer key={b.uid} box={b} {...p} />
          ))}
        </div>
      </div>
    </div>
  );
});

// --- Calque d'une page ------------------------------------------------------------

function PageLayer({ box, ...p }: { box: PageBox } & Props) {
  const list = p.objects[box.uid] ?? [];
  const layer = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<PageObject | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const drawing = p.tool !== "select" && p.tool !== "editText" && !p.readOnly;

  const local = (e: { clientX: number; clientY: number }) => {
    const r = layer.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const baseOf = (x0: number, y0: number, dx: number, dy: number) => {
    const { vp } = box;
    const [px, py] = vp.convertToPdfPoint(x0, y0);
    return { id: newId(), x: px, y: py, w: dx / vp.scale, h: dy / vp.scale, angle: vp.rotation };
  };

  const onDown = (e: RPE<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (!drawing) {
      if (p.tool === "select" && e.target === layer.current) p.onSelect(null, null);
      return;
    }
    e.preventDefault();
    const [x0, y0] = local(e);
    const st = p.style;
    if (p.tool === "text") {
      const o: TextObj = { ...baseOf(x0, y0, 0, 0), kind: "text", w: 220, h: st.size * LINE_HEIGHT, text: "", family: st.family, bold: st.bold, italic: st.italic, size: st.size, color: st.color, align: st.align };
      p.onAddObject(box.uid, o, "Ajouter du texte");
      setEditingText(o.id);
      p.onToolDone();
      return;
    }
    const make = (x: number, y: number): PageObject => {
      const tl = p.tool === "line" ? [x0, y0] : [Math.min(x0, x), Math.min(y0, y)];
      const dx = p.tool === "line" ? x - x0 : Math.abs(x - x0);
      const dy = p.tool === "line" ? y - y0 : Math.abs(y - y0);
      const b = baseOf(tl[0], tl[1], dx, dy);
      if (p.tool === "highlight") return { ...b, kind: "highlight", color: st.highlight };
      if (p.tool === "whiteout") return { ...b, kind: "whiteout", color: [1, 1, 1] };
      return { ...b, kind: p.tool as "rect" | "ellipse" | "line", stroke: st.color, fill: p.tool === "line" ? null : st.fill, strokeWidth: st.strokeWidth, opacity: st.opacity };
    };
    let cur = make(x0, y0);
    setDraft(cur);
    layer.current!.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const [x, y] = local(ev);
      cur = { ...make(x, y), id: cur.id };
      setDraft(cur);
    };
    const up = () => {
      layer.current?.removeEventListener("pointermove", move);
      layer.current?.removeEventListener("pointerup", up);
      setDraft(null);
      if (Math.hypot(cur.w, cur.h) * box.vp.scale >= 5) {
        p.onAddObject(box.uid, cur, "Ajouter un objet");
        p.onToolDone();
      }
    };
    layer.current!.addEventListener("pointermove", move);
    layer.current!.addEventListener("pointerup", up);
  };

  return (
    <div ref={layer} className={`page-layer${drawing ? " drawing" : ""}`} style={{ left: box.left, top: box.top, width: box.width, height: box.height }} onPointerDown={onDown} onMouseDown={(e) => drawing && e.preventDefault()}>
      {list.map((o) => (
        <ObjectView key={o.id} o={o} vp={box.vp} uid={box.uid} selected={p.selected === o.id} interactive={p.tool === "select" && !p.readOnly} startEditing={editingText === o.id} onEditingDone={() => setEditingText(null)} onSelect={p.onSelect} onChange={p.onChangeObject} onRemove={p.onRemoveObject} />
      ))}
      {draft && <ObjectView o={draft} vp={box.vp} uid={box.uid} selected={false} interactive={false} onSelect={p.onSelect} onChange={p.onChangeObject} />}
      {p.tool === "editText" && !p.readOnly && <RunsLayer box={box} bytes={p.bytes} onEditRun={p.onEditRun} />}
    </div>
  );
}

// --- Objets ajoutés --------------------------------------------------------------------

function ObjectView({ o, vp, uid, selected, interactive, startEditing, onEditingDone, onSelect, onChange, onRemove }: {
  o: PageObject;
  vp: Viewport;
  uid: string;
  selected: boolean;
  interactive: boolean;
  startEditing?: boolean;
  onEditingDone?: () => void;
  onSelect: Props["onSelect"];
  onChange: Props["onChangeObject"];
  onRemove?: Props["onRemoveObject"];
}) {
  const [live, setLive] = useState<PageObject | null>(null);
  const [editing, setEditing] = useState(false);
  const cur = live ?? o;
  const s = vp.scale;
  const [left, top] = vp.convertToViewportPoint(cur.x, cur.y);
  const screenAngle = (((vp.rotation - cur.angle) % 360) + 360) % 360;
  const rad = (screenAngle * Math.PI) / 180;

  useEffect(() => {
    if (startEditing) {
      setEditing(true);
      onSelect(o.id, uid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startEditing]);

  /** Déplacement écran → décalage dans le repère de l'objet (points). */
  const toLocal = (dx: number, dy: number) => [(dx * Math.cos(rad) + dy * Math.sin(rad)) / s, (-dx * Math.sin(rad) + dy * Math.cos(rad)) / s];
  const shift = (x: PageObject, u: number, v: number): PageObject => {
    const a = (x.angle * Math.PI) / 180;
    return { ...x, x: x.x + u * Math.cos(a) + v * Math.sin(a), y: x.y + u * Math.sin(a) - v * Math.cos(a) };
  };

  const drag = (e: RPE, apply: (dx: number, dy: number) => PageObject, label: string) => {
    e.stopPropagation();
    e.preventDefault();
    const [sx, sy] = [e.clientX, e.clientY];
    let last: PageObject | null = null;
    const move = (ev: PointerEvent) => {
      last = apply(ev.clientX - sx, ev.clientY - sy);
      setLive(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setLive(null);
      if (last) onChange(uid, last, label);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startMove = (e: RPE) => {
    if (!interactive || editing) return;
    onSelect(o.id, uid);
    drag(e, (dx, dy) => {
      const [u, v] = toLocal(dx, dy);
      return shift(o, u, v);
    }, "Déplacer");
  };

  const startResize = (e: RPE, h: string) => {
    const keepRatio = o.kind === "image";
    drag(e, (dx, dy) => {
      let [u, v] = toLocal(dx, dy);
      if (o.kind === "line") return h === "start" ? { ...shift(o, u, v), w: o.w - u, h: o.h - v } : { ...o, w: o.w + u, h: o.h + v };
      if (keepRatio && h.length === 2) {
        const k = Math.max((h.includes("e") ? u : -u) / o.w, (h.includes("s") ? v : -v) / o.h);
        u = (h.includes("e") ? 1 : -1) * k * o.w;
        v = (h.includes("s") ? 1 : -1) * k * o.h;
      }
      let [du, dv, w, hh] = [0, 0, o.w, o.h];
      if (h.includes("e")) w = Math.max(6, o.w + u);
      if (h.includes("s")) hh = Math.max(6, o.h + v);
      if (h.includes("w")) {
        w = Math.max(6, o.w - u);
        du = o.w - w;
      }
      if (h.includes("n")) {
        hh = Math.max(6, o.h - v);
        dv = o.h - hh;
      }
      return { ...shift(o, du, dv), w, h: hh };
    }, "Redimensionner");
  };

  const finishEditing = (text: string) => {
    setEditing(false);
    onEditingDone?.();
    if (o.kind !== "text") return;
    if (!text.trim()) {
      onRemove?.(uid, o.id);
      return;
    }
    if (text === o.text) return;
    const lines = wrapLines({ ...o, text }).length;
    onChange(uid, { ...o, text, h: Math.max(o.h, lines * o.size * LINE_HEIGHT) }, "Modifier le texte");
  };

  const line = cur.kind === "line";
  const style = {
    left, top,
    width: line ? 0 : cur.w * s,
    height: line ? 0 : cur.h * s,
    transform: `rotate(${screenAngle}deg)`,
    pointerEvents: interactive ? ("auto" as const) : ("none" as const),
  };
  return (
    <div className={`pw-object kind-${cur.kind}${selected && interactive ? " selected" : ""}`} style={style} onPointerDown={startMove} onDoubleClick={() => cur.kind === "text" && interactive && setEditing(true)}>
      <ObjectBody o={cur} s={s} editing={editing} onFinish={finishEditing} />
      {selected && interactive && !editing && !line && ["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((h) => <span key={h} className={`handle h-${h}`} onPointerDown={(e) => startResize(e, h)} />)}
      {selected && interactive && line && (
        <>
          <span className="handle" style={{ left: -5, top: -5, cursor: "move" }} onPointerDown={(e) => startResize(e, "start")} />
          <span className="handle" style={{ left: cur.w * s - 5, top: cur.h * s - 5, cursor: "move" }} onPointerDown={(e) => startResize(e, "end")} />
        </>
      )}
    </div>
  );
}

function ObjectBody({ o, s, editing, onFinish }: { o: PageObject; s: number; editing: boolean; onFinish: (t: string) => void }) {
  switch (o.kind) {
    case "text": {
      const font = { fontFamily: FONT_STACK[o.family], fontWeight: o.bold ? 700 : 400, fontStyle: o.italic ? "italic" : "normal", fontSize: o.size * s, lineHeight: `${o.size * LINE_HEIGHT * s}px`, color: css(o.color), textAlign: o.align };
      if (editing) return <TextEditor o={o} font={font} onFinish={onFinish} />;
      const lines = wrapLines(o);
      return (
        <div className="text-lines" style={font}>
          {o.text ? lines.map((l, i) => <div key={i} className="text-line">{l || " "}</div>) : <div className="text-line placeholder">Texte</div>}
        </div>
      );
    }
    case "image":
      return <img src={o.url} alt="" draggable={false} className="object-image" />;
    case "rect":
    case "ellipse": {
      const sw = o.strokeWidth * s;
      return (
        <svg className="object-svg" width="100%" height="100%" style={{ opacity: o.opacity }}>
          {o.kind === "rect" ? (
            <rect x={0} y={0} width="100%" height="100%" fill={o.fill ? css(o.fill) : "none"} stroke={o.stroke ? css(o.stroke) : "none"} strokeWidth={sw} />
          ) : (
            <ellipse cx="50%" cy="50%" rx="50%" ry="50%" fill={o.fill ? css(o.fill) : "none"} stroke={o.stroke ? css(o.stroke) : "none"} strokeWidth={sw} />
          )}
        </svg>
      );
    }
    case "line":
      return (
        <svg className="object-svg line" width={1} height={1} style={{ opacity: o.opacity }}>
          <line x1={0} y1={0} x2={o.w * s} y2={o.h * s} stroke={css(o.stroke ?? [0, 0, 0])} strokeWidth={Math.max(1, o.strokeWidth * s)} strokeLinecap="round" />
          <line x1={0} y1={0} x2={o.w * s} y2={o.h * s} stroke="transparent" strokeWidth={12} style={{ pointerEvents: "stroke" }} />
        </svg>
      );
    case "highlight":
      return <div className="object-fill multiply" style={{ background: css(o.color) }} />;
    case "whiteout":
      return <div className="object-fill" style={{ background: css(o.color) }} />;
  }
}

function TextEditor({ o, font, onFinish }: { o: TextObj; font: React.CSSProperties; onFinish: (t: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(o.text);
  useEffect(() => {
    // Après le clic qui a créé la zone : il ne doit pas lui retirer le focus.
    const t = window.setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <textarea
      ref={ref}
      className="text-editor"
      style={font}
      value={text}
      placeholder="Texte"
      onChange={(e) => setText(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => onFinish(text)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") ref.current?.blur();
      }}
    />
  );
}

// --- Texte existant du PDF ---------------------------------------------------------------

const runsCache = new WeakMap<Uint8Array, Map<number, Promise<TextRun[]>>>();
function runsOf(bytes: Uint8Array, page: number) {
  let m = runsCache.get(bytes);
  if (!m) {
    m = new Map();
    runsCache.set(bytes, m);
  }
  let r = m.get(page);
  if (!r) {
    r = core("listRuns", bytes, page);
    m.set(page, r);
  }
  return r;
}

function RunsLayer({ box, bytes, onEditRun }: { box: PageBox; bytes: Uint8Array; onEditRun: Props["onEditRun"] }) {
  const [runs, setRuns] = useState<TextRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<TextRun | null>(null);
  useEffect(() => {
    let alive = true;
    setEdit(null);
    setRuns(null);
    setError(null);
    runsOf(bytes, box.index).then(
      (r) => alive && setRuns(r),
      (e: CoreCallError) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [bytes, box.index]);
  if (error) return <div className="runs-note">{error}</div>;
  if (!runs) return null;
  const { vp } = box;
  const s = vp.scale;
  return (
    <>
      {runs.length === 0 && <div className="runs-note">Aucun texte modifiable sur cette page (image numérisée, ou texte placé dans un objet réutilisable).</div>}
      {runs.map((r) => {
        const [x, y] = vp.convertToViewportPoint(r.x, r.y);
        const a = (((vp.rotation - r.angle) % 360) + 360) % 360;
        const st = { left: x, top: y, width: Math.max(r.width * s, 6), height: r.size * s * 1.2, transform: `rotate(${a}deg) translateY(${-r.size * s * 0.92}px)` };
        return edit?.id === r.id ? (
          <RunEditor key={r.id} run={r} style={st} s={s} onCancel={() => setEdit(null)} onCommit={async (e) => { setEdit(null); await onEditRun(box.index, r, e); }} />
        ) : (
          <button key={r.id} className={`run${r.readable ? "" : " unreadable"}`} style={st} title={r.readable ? `${r.fontName}, ${Math.round(r.size * 10) / 10} pt` : "Texte non déchiffrable"} onPointerDown={(e) => e.stopPropagation()} onClick={() => r.readable && setEdit(r)} />
        );
      })}
    </>
  );
}

function RunEditor({ run, style, s, onCommit, onCancel }: { run: TextRun; style: React.CSSProperties; s: number; onCommit: (e: RunEdit) => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState(run.text);
  const [size, setSize] = useState(Math.round(run.size * 10) / 10);
  const [color, setColor] = useState(run.color);
  const [bold, setBold] = useState(run.bold);
  const [italic, setItalic] = useState(run.italic);
  const input = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    const e: RunEdit = { text };
    if (Math.abs(size - Math.round(run.size * 10) / 10) > 0.01) e.size = size;
    if (color.some((c, i) => Math.abs(c - run.color[i]) > 0.003)) e.color = color;
    if (bold !== run.bold) e.bold = bold;
    if (italic !== run.italic) e.italic = italic;
    if (text === run.text && Object.keys(e).length === 1) onCancel();
    else void onCommit(e);
  };
  // Un clic ailleurs valide.
  useEffect(() => {
    const down = (ev: PointerEvent) => {
      if (!boxRef.current?.contains(ev.target as Node)) commit();
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  });
  const hex = "#" + color.map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
  return (
    <div ref={boxRef} className="run-editor" style={{ ...style, width: "auto", height: "auto" }} onPointerDown={(e) => e.stopPropagation()}>
      <input
        ref={input}
        className="run-input"
        style={{ fontFamily: FONT_STACK[run.family], fontWeight: bold ? 700 : 400, fontStyle: italic ? "italic" : "normal", fontSize: size * s, height: size * s * 1.2, color: hex, width: Math.max((run.width * s) + 24, (text.length + 2) * size * s * 0.55) }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            done.current = true;
            onCancel();
          }
        }}
      />
      <div className="run-bar">
        <span className="run-font" title="Police du document">{run.fontName}</span>
        <input type="number" min={1} max={400} step={0.5} value={size} title="Taille" onChange={(e) => setSize(Number(e.target.value) || size)} />
        <input type="color" value={hex} title="Couleur" onChange={(e) => {
          const h = e.target.value;
          setColor([1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb);
        }} />
        <button className={bold ? "on" : ""} title="Gras" onClick={() => setBold(!bold)}><b>G</b></button>
        <button className={italic ? "on" : ""} title="Italique" onClick={() => setItalic(!italic)}><i>I</i></button>
        <button title="Valider (Entrée)" onClick={commit}><Icon name="check" size={14} /></button>
        <button title="Annuler (Échap)" onClick={() => { done.current = true; onCancel(); }}><Icon name="close" size={14} /></button>
      </div>
    </div>
  );
}

