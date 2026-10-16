// Diaporama plein écran : LibreOfficeKit n'exécute pas « .uno:Presentation »,
// on rend donc chaque diapositive à la taille de l'écran et on navigue au
// clavier ou à la souris. Les animations et transitions ne sont pas jouées.

import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { paint } from "./engine";

type Props = { doc: number; count: number; start: number; width: number; height: number; onClose: () => void };

export function SlideShow({ doc, count, start, width, height, onClose }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [slide, setSlide] = useState(start);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    const w = getCurrentWindow();
    let wasFull = false;
    void w.isFullscreen().then((f) => {
      wasFull = f;
      if (!f) void w.setFullscreen(true);
    }).catch(() => {});
    return () => {
      if (!wasFull) void w.setFullscreen(false).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (ended) return;
    let alive = true;
    const draw = () => {
      const c = ref.current;
      if (!c) return;
      const scale = window.devicePixelRatio || 1;
      const sw = window.innerWidth, sh = window.innerHeight;
      const fit = Math.min(sw / width, sh / height);
      const cssW = Math.max(1, Math.floor(width * fit)), cssH = Math.max(1, Math.floor(height * fit));
      const pw = Math.round(cssW * scale), ph = Math.round(cssH * scale);
      void paint(doc, { px_w: pw, px_h: ph, x: 0, y: 0, w: width, h: height, part: slide }).then((px) => {
        if (!alive || !ref.current) return;
        c.width = pw;
        c.height = ph;
        c.style.width = `${cssW}px`;
        c.style.height = `${cssH}px`;
        c.getContext("2d")!.putImageData(new ImageData(px, pw, ph), 0, 0);
      });
    };
    draw();
    window.addEventListener("resize", draw);
    return () => {
      alive = false;
      window.removeEventListener("resize", draw);
    };
  }, [doc, slide, ended, width, height]);

  const next = useCallback(() => {
    if (ended) onClose();
    else if (slide + 1 < count) setSlide(slide + 1);
    else setEnded(true);
  }, [slide, count, ended, onClose]);
  const prev = useCallback(() => {
    if (ended) setEnded(false);
    else setSlide(Math.max(0, slide - 1));
  }, [slide, ended]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
        case " ":
        case "Enter":
        case "n":
          next();
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
        case "Backspace":
        case "p":
          prev();
          break;
        case "Home":
          setEnded(false);
          setSlide(0);
          break;
        case "End":
          setEnded(false);
          setSlide(count - 1);
          break;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [next, prev, count, onClose]);

  return (
    <div
      className="slideshow"
      tabIndex={-1}
      onClick={next}
      onContextMenu={(e) => {
        e.preventDefault();
        prev();
      }}
    >
      {ended ? <div className="slideshow-end">Fin du diaporama — cliquez ou appuyez sur Échap pour quitter.</div> : <canvas ref={ref} />}
      <div className="slideshow-num">{ended ? "" : `${slide + 1} / ${count}`}</div>
    </div>
  );
}
