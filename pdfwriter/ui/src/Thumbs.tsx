// Panneau des pages : miniatures dessinées à la demande, sélection multiple,
// déplacement par glisser (avec le pointeur : le glisser-déposer du système
// reste réservé aux fichiers reçus de l'extérieur).

import { memo, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PageMeta } from "./model";

interface Props {
  pdf: PDFDocumentProxy | null;
  pages: PageMeta[];
  current: number;
  selection: Set<string>;
  editable: boolean;
  onActivate(index: number, e: { ctrl: boolean; shift: boolean }): void;
  onMove(moved: number[], before: number): void;
  onContext(index: number, x: number, y: number): void;
}

const THUMB_WIDTH = 140;

const Thumb = memo(function Thumb({ pdf, index, rev, version }: { pdf: PDFDocumentProxy; index: number; rev: number; version: unknown }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState(1.3);
  useEffect(() => {
    let alive = true;
    let cancel: (() => void) | null = null;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void (async () => {
          try {
            const page = await pdf.getPage(index + 1);
            if (!alive || !canvas.current) return;
            const base = page.getViewport({ scale: 1 });
            const dpr = window.devicePixelRatio || 1;
            const vp = page.getViewport({ scale: (THUMB_WIDTH / base.width) * dpr });
            setRatio(base.height / base.width);
            const c = canvas.current;
            c.width = Math.ceil(vp.width);
            c.height = Math.ceil(vp.height);
            const task = page.render({ canvas: c, viewport: vp, background: "#fff" });
            cancel = () => task.cancel();
            await task.promise;
          } catch {
            // Rendu annulé : la miniature sera refaite.
          }
        })();
      },
      { rootMargin: "300px" },
    );
    if (box.current) io.observe(box.current);
    return () => {
      alive = false;
      io.disconnect();
      cancel?.();
    };
  }, [pdf, index, rev, version]);
  return (
    <div ref={box} className="thumb-paper" style={{ height: THUMB_WIDTH * ratio }}>
      <canvas ref={canvas} />
    </div>
  );
});

export function Thumbs({ pdf, pages, current, selection, editable, onActivate, onMove, onContext }: Props) {
  const list = useRef<HTMLDivElement>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${current - 1}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const startDrag = (e: React.PointerEvent, index: number) => {
    if (e.button !== 0 || !editable) return;
    const [sx, sy] = [e.clientX, e.clientY];
    const uid = pages[index].uid;
    const moved = selection.has(uid) ? pages.flatMap((p, i) => (selection.has(p.uid) ? [i] : [])) : [index];
    let active = false;
    let target: number | null = null;
    const where = (ev: PointerEvent) => {
      const el = list.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (ev.clientY < r.top + 30) el.scrollTop -= 14;
      if (ev.clientY > r.bottom - 30) el.scrollTop += 14;
      const items = [...el.querySelectorAll<HTMLElement>("[data-index]")];
      for (const it of items) {
        const b = it.getBoundingClientRect();
        if (ev.clientY < b.top + b.height / 2) return Number(it.dataset.index);
      }
      return pages.length;
    };
    const move = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      active = true;
      target = where(ev);
      setDropAt(target);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDropAt(null);
      if (active && target !== null) onMove(moved, target);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div ref={list} className="thumbs">
      {pdf &&
        pages.map((p, i) =>
          i < pdf.numPages ? (
            <div key={p.uid}>
              {dropAt === i && <div className="drop-mark" />}
              <div
                data-index={i}
                className={`thumb${current === i + 1 ? " current" : ""}${selection.has(p.uid) ? " selected" : ""}`}
                onPointerDown={(e) => startDrag(e, i)}
                onClick={(e) => onActivate(i, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onContext(i, e.clientX, e.clientY);
                }}
              >
                <Thumb pdf={pdf} index={i} rev={p.rev} version={pdf} />
                <span className="thumb-num">{i + 1}</span>
              </div>
            </div>
          ) : null,
        )}
      {dropAt === pages.length && <div className="drop-mark" />}
    </div>
  );
}
