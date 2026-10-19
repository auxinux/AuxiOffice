// Boîtes de dialogue de LibreOffice (Caractère, Paragraphe, Style de page,
// Rechercher et remplacer…) : LibreOffice les annonce par les rappels
// « window » ; AuxiOffice les dessine (paintWindow) et leur transmet souris
// et clavier. Les fenêtres « child » (listes déroulantes) se placent sur leur
// fenêtre parente.

import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { call, paintWindow, uiLog } from "./engine";
import { lokKeyFor, parseRects, type Rect } from "./lok";

const IS_MAC = navigator.platform.toLowerCase().includes("mac");

interface Win {
  id: number;
  type: string;
  parentId: number | null;
  title: string;
  w: number;
  h: number;
  x: number; // position dans la fenêtre parente (fenêtres enfants)
  y: number;
  cursor: Rect | null;
  cursorVisible: boolean;
}

export interface DialogLayerHandle {
  /** Rappel « window » de LibreOffice. */
  onWindowEvent: (payload: string) => void;
  hasDialog: () => boolean;
}

interface Props {
  doc: number;
  onClosed: () => void;
}

export const DialogLayer = forwardRef<DialogLayerHandle, Props>(function DialogLayer({ doc, onClosed }, ref) {
  const [wins, setWins] = useState<Win[]>([]);
  const winsRef = useRef<Win[]>([]);
  winsRef.current = wins;
  const canvases = useRef(new Map<number, HTMLCanvasElement>());
  const pending = useRef(new Map<number, Rect | "all">());
  const frame = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const lastMove = useRef(0);

  const dpr = () => window.devicePixelRatio || 1;

  // Rendu : les zones invalidées sont regroupées par image et par fenêtre.
  const flush = useCallback(() => {
    frame.current = 0;
    const work = [...pending.current.entries()];
    pending.current.clear();
    for (const [id, area] of work) {
      const win = winsRef.current.find((w) => w.id === id);
      const canvas = canvases.current.get(id);
      if (!win || !canvas) continue;
      const r = area === "all" ? { x: 0, y: 0, w: win.w, h: win.h } : clip(area, win);
      if (r.w <= 0 || r.h <= 0) continue;
      const scale = dpr();
      const t0 = performance.now();
      void paintWindow(doc, { window: id, x: r.x, y: r.y, w: r.w, h: r.h, scale })
        .then((px) => {
          const c = canvases.current.get(id);
          if (!c) return;
          const pw = Math.round(r.w * scale);
          const ph = Math.round(r.h * scale);
          if (px.length !== pw * ph * 4) {
            uiLog(`boîte ${id} : rendu de ${px.length} octets au lieu de ${pw * ph * 4} (${r.w}×${r.h} à l'échelle ${scale})`);
            return;
          }
          c.getContext("2d")!.putImageData(new ImageData(px, pw, ph), Math.round(r.x * scale), Math.round(r.y * scale));
          const ms = performance.now() - t0;
          if (ms > 3000) uiLog(`boîte ${id} : rendu lent (${Math.round(ms)} ms)`);
        })
        .catch((e) => uiLog(`boîte ${id} : rendu impossible : ${e}`));
    }
  }, [doc]);

  const invalidate = useCallback(
    (id: number, rect: Rect | "all") => {
      const prev = pending.current.get(id);
      pending.current.set(id, prev === "all" || rect === "all" ? "all" : prev ? union(prev, rect) : rect);
      if (!frame.current) frame.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  useImperativeHandle(
    ref,
    () => ({
      hasDialog: () => winsRef.current.length > 0,
      onWindowEvent: (payload: string) => {
        let e: Record<string, string>;
        try {
          e = JSON.parse(payload);
        } catch {
          return;
        }
        const id = Number(e.id);
        const size = (s?: string) => (s ? s.split(",").map((v) => Number(v.trim())) : [0, 0]);
        switch (e.action) {
          case "created": {
            if (e.type !== "dialog" && e.type !== "child") return; // infobulles, etc.
            const [w, h] = size(e.size);
            const [x, y] = size(e.position);
            const win: Win = { id, type: e.type, parentId: e.parentId ? Number(e.parentId) : null, title: e.title ?? "", w, h, x, y, cursor: null, cursorVisible: false };
            setWins((ws) => [...ws.filter((o) => o.id !== id), win]);
            if (e.type === "dialog") setOffset({ x: 0, y: 0 });
            requestAnimationFrame(() => invalidate(id, "all"));
            break;
          }
          case "size_changed": {
            const [w, h] = size(e.size);
            setWins((ws) => ws.map((o) => (o.id === id ? { ...o, w, h } : o)));
            requestAnimationFrame(() => invalidate(id, "all"));
            break;
          }
          case "invalidate": {
            const r = parseRects(e.rectangle ?? "")[0];
            invalidate(id, r ?? "all");
            break;
          }
          case "title_changed":
            setWins((ws) => ws.map((o) => (o.id === id ? { ...o, title: e.title ?? o.title } : o)));
            break;
          case "cursor_invalidate":
            setWins((ws) => ws.map((o) => (o.id === id ? { ...o, cursor: parseRects(e.rectangle ?? "")[0] ?? null } : o)));
            break;
          case "cursor_visible":
            setWins((ws) => ws.map((o) => (o.id === id ? { ...o, cursorVisible: e.visible === "true" } : o)));
            break;
          case "close":
          case "hide":
            setWins((ws) => {
              const rest = ws.filter((o) => o.id !== id && o.parentId !== id);
              if (!rest.some((o) => o.type === "dialog")) window.setTimeout(onClosed, 0);
              return rest;
            });
            break;
        }
      },
    }),
    [invalidate, onClosed],
  );

  const dialogs = wins.filter((w) => w.type === "dialog");
  const top = dialogs[dialogs.length - 1];

  // Le clavier va à la boîte de dialogue au premier plan.
  useEffect(() => {
    if (top) inputRef.current?.focus({ preventScroll: true });
  }, [top?.id]);

  const sendMouse = (win: Win, kind: "down" | "up" | "move", e: React.PointerEvent) => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.round(e.clientX - box.left);
    const y = Math.round(e.clientY - box.top);
    // Survol : au plus un mouvement toutes les 30 ms (surlignage des listes).
    if (kind === "move") {
      if (e.timeStamp - lastMove.current < 30) return;
      lastMove.current = e.timeStamp;
    }
    const buttons = e.button === 2 || e.buttons === 2 ? 4 : 1;
    let mods = 0;
    if (e.shiftKey) mods |= 0x1000;
    if (IS_MAC ? e.metaKey : e.ctrlKey) mods |= 0x2000;
    if (e.altKey) mods |= 0x4000;
    if (kind === "down") (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    void call(doc, "window_mouse", { window: win.id, kind, x, y, count: e.detail || 1, buttons, mods });
    if (kind === "up") inputRef.current?.focus({ preventScroll: true });
  };

  const target = () => {
    // Les touches vont à la liste déroulante ouverte, sinon à la boîte de dialogue.
    const ws = winsRef.current;
    return ws[ws.length - 1];
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const w = target();
    if (!w || e.nativeEvent.isComposing) return;
    const lk = lokKeyFor(e.nativeEvent, IS_MAC);
    if (lk) {
      e.preventDefault();
      void call(doc, "window_key", { window: w.id, char: lk.char, code: lk.code }).then(() =>
        call(doc, "window_key", { window: w.id, kind: "up", char: lk.char, code: lk.code }),
      );
    }
  };

  const onInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const w = target();
    const t = e.currentTarget.value;
    e.currentTarget.value = "";
    if (w && t) void call(doc, "window_text", { window: w.id, text: t.replace(/\r?\n/g, "") });
  };

  if (!top) return null;

  const renderWin = (w: Win) => (
    <div key={w.id} className={`lo-win ${w.type}`} style={w.type === "child" ? { left: w.x, top: w.y } : undefined}>
      <canvas
        ref={(c) => {
          if (c) {
            const scale = dpr();
            if (c.width !== Math.round(w.w * scale)) c.width = Math.round(w.w * scale);
            if (c.height !== Math.round(w.h * scale)) c.height = Math.round(w.h * scale);
            canvases.current.set(w.id, c);
          } else canvases.current.delete(w.id);
        }}
        style={{ width: w.w, height: w.h }}
        onPointerDown={(e) => sendMouse(w, "down", e)}
        onPointerUp={(e) => sendMouse(w, "up", e)}
        onPointerMove={(e) => sendMouse(w, "move", e)}
        onContextMenu={(e) => e.preventDefault()}
      />
      {w.cursor && w.cursorVisible && <div className="lo-caret" style={{ left: w.cursor.x, top: w.cursor.y, height: w.cursor.h }} />}
      {wins.filter((c) => c.parentId === w.id).map(renderWin)}
    </div>
  );

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && inputRef.current?.focus()}>
      <div className="lo-dialog" style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }} role="dialog" aria-label={top.title}>
        <div
          className="lo-title"
          onPointerDown={(e) => {
            drag.current = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (d && e.buttons) setOffset({ x: d.ox + e.clientX - d.sx, y: d.oy + e.clientY - d.sy });
          }}
          onPointerUp={() => (drag.current = null)}
        >
          <span>{top.title}</span>
          <button title="Fermer" onClick={() => void call(doc, "window_close", { window: top.id }).catch((e) => uiLog(`boîte ${top.id} : fermeture impossible : ${e}`))}>
            ×
          </button>
        </div>
        {renderWin(top)}
        <textarea ref={inputRef} className="ime" onKeyDown={onKeyDown} onInput={onInput} aria-label="Saisie dans la boîte de dialogue" />
      </div>
    </div>
  );
});

function clip(r: Rect, w: { w: number; h: number }): Rect {
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  return { x, y, w: Math.min(w.w - x, Math.ceil(r.w) + 1), h: Math.min(w.h - y, Math.ceil(r.h) + 1) };
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
