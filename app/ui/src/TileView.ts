// Affichage du document par tuiles : demande au moteur les tuiles visibles,
// les garde en cache, les invalide sur rappel et dessine curseur et sélection.
// Classe impérative (hors React) pour que le défilement reste fluide.

import { paint } from "./engine";
import { TWIPS_PER_PX, intersects, type Rect } from "./lok";

const TILE_PX = 256; // pixels physiques par tuile
const MAX_INFLIGHT = 4;
const MAX_CACHE = 600;
/** Marge autour des pages, en pixels CSS. */
export const PAGE_MARGIN = 16;

interface Tile {
  image: ImageBitmap | HTMLCanvasElement | null;
  stale: boolean;
  loading: boolean;
  used: number;
}

export interface Overlays {
  cursor: Rect | null;
  cursorVisible: boolean;
  selection: Rect[];
  cellCursor: Rect | null;
  graphic: Rect | null;
}

export class TileView {
  zoom = 1;
  part = 0;
  docW = 0;
  docH = 0;
  readonly overlays: Overlays = { cursor: null, cursorVisible: true, selection: [], cellCursor: null, graphic: null };
  private tiles = new Map<string, Tile>();
  private inflight = 0;
  private frame = 0;
  private blink = true;
  private blinkTimer: number;
  private disposed = false;
  private clock = 0;
  /** Appelé quand la zone visible change (tableur : zone et zoom à signaler au moteur). */
  onViewportChange: (() => void) | null = null;

  constructor(
    private doc: number,
    private canvas: HTMLCanvasElement,
    private scroller: HTMLElement,
    private spacer: HTMLElement,
    /** Ajouter une marge et centrer le document (texte, présentation). */
    private framed: boolean,
    /** Préciser la partie à chaque tuile (diapositives) ; sinon partie active. */
    private partTiles = false,
  ) {
    this.blinkTimer = window.setInterval(() => {
      this.blink = !this.blink;
      if (this.overlays.cursor && this.overlays.cursorVisible) this.schedule();
    }, 530);
    scroller.addEventListener("scroll", this.onScroll, { passive: true });
    window.addEventListener("resize", this.onScroll);
  }

  dispose() {
    this.disposed = true;
    window.clearInterval(this.blinkTimer);
    this.scroller.removeEventListener("scroll", this.onScroll);
    window.removeEventListener("resize", this.onScroll);
    cancelAnimationFrame(this.frame);
    this.tiles.clear();
  }

  private onScroll = () => {
    this.schedule();
    this.onViewportChange?.();
  };

  get dpr() {
    return window.devicePixelRatio || 1;
  }

  /** Pixels CSS par twip. */
  get scale() {
    return this.zoom / TWIPS_PER_PX;
  }

  /** Twips couverts par une tuile. */
  get tileTwips() {
    return Math.round(TILE_PX / this.dpr / this.scale);
  }

  private get margin() {
    return this.framed ? PAGE_MARGIN : 0;
  }

  /** Origine du document dans la zone défilante (pixels CSS). */
  get origin() {
    const docPx = this.docW * this.scale;
    const x = this.framed ? Math.max(this.margin, (this.scroller.clientWidth - docPx) / 2) : 0;
    return { x, y: this.margin };
  }

  setDocSize(w: number, h: number) {
    this.docW = w;
    this.docH = h;
    this.layout();
  }

  setZoom(z: number) {
    const anchor = this.clientToDoc(this.scroller.clientWidth / 2, this.scroller.clientHeight / 2);
    this.zoom = Math.min(4, Math.max(0.25, z));
    this.tiles.clear();
    this.layout();
    this.scrollToDoc(anchor.x, anchor.y, true);
    this.onViewportChange?.();
  }

  setPart(part: number) {
    if (part === this.part) return;
    this.part = part;
    this.schedule();
  }

  private layout() {
    const s = this.scale;
    this.spacer.style.width = `${Math.ceil(this.docW * s + 2 * this.margin)}px`;
    this.spacer.style.height = `${Math.ceil(this.docH * s + 2 * this.margin)}px`;
    this.schedule();
  }

  /** Invalide une zone (twips) ou tout, pour une partie ou toutes. */
  invalidate(rect: Rect | null, part: number | null) {
    for (const [key, t] of this.tiles) {
      const [p, z, tx, ty] = key.split(":").map(Number);
      if (part !== null && p !== part) continue;
      if (z !== this.zoom) continue;
      if (rect) {
        const tt = this.tileTwips;
        if (!intersects(rect, { x: tx * tt, y: ty * tt, w: tt, h: tt })) continue;
      }
      t.stale = true;
    }
    this.schedule();
  }

  schedule() {
    if (this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  /** Coordonnées client (relatives à la zone défilante) → twips du document. */
  clientToDoc(cx: number, cy: number) {
    const o = this.origin;
    return {
      x: Math.round((cx + this.scroller.scrollLeft - o.x) / this.scale),
      y: Math.round((cy + this.scroller.scrollTop - o.y) / this.scale),
    };
  }

  /** Zone visible en twips. */
  visibleDocRect(): Rect {
    const a = this.clientToDoc(0, 0);
    return { x: Math.max(0, a.x), y: Math.max(0, a.y), w: Math.round(this.scroller.clientWidth / this.scale), h: Math.round(this.scroller.clientHeight / this.scale) };
  }

  /** Fait défiler pour rendre visible le point (twips). */
  scrollToDoc(x: number, y: number, center = false) {
    const o = this.origin;
    const px = x * this.scale + o.x;
    const py = y * this.scale + o.y;
    const sl = this.scroller.scrollLeft;
    const st = this.scroller.scrollTop;
    const vw = this.scroller.clientWidth;
    const vh = this.scroller.clientHeight;
    if (center) {
      this.scroller.scrollTo(px - vw / 2, py - vh / 2);
      return;
    }
    const pad = 40;
    let nl = sl;
    let nt = st;
    if (px < sl + pad) nl = px - pad;
    else if (px > sl + vw - pad) nl = px - vw + pad;
    if (py < st + pad) nt = py - pad;
    else if (py > st + vh - pad) nt = py - vh + pad * 2;
    if (nl !== sl || nt !== st) this.scroller.scrollTo(nl, nt);
  }

  /** Rend visible le curseur (après saisie ou déplacement au clavier). */
  revealCursor() {
    const c = this.overlays.cursor ?? this.overlays.cellCursor;
    if (c) {
      this.scrollToDoc(c.x, c.y + c.h);
      this.scrollToDoc(c.x, c.y);
    }
  }

  private draw() {
    const { canvas, scroller } = this;
    const dpr = this.dpr;
    const vw = scroller.clientWidth;
    const vh = scroller.clientHeight;
    if (canvas.width !== Math.round(vw * dpr) || canvas.height !== Math.round(vh * dpr)) {
      canvas.width = Math.round(vw * dpr);
      canvas.height = Math.round(vh * dpr);
      canvas.style.width = `${vw}px`;
      canvas.style.height = `${vh}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx || this.docW <= 0 || this.docH <= 0) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;

    const s = this.scale;
    const o = this.origin;
    const tt = this.tileTwips;
    const tileCss = tt * s;
    // Décalage écran du point (0,0) du document, en pixels physiques.
    const ox = (o.x - scroller.scrollLeft) * dpr;
    const oy = (o.y - scroller.scrollTop) * dpr;

    const view = this.visibleDocRect();
    const tx0 = Math.max(0, Math.floor(view.x / tt));
    const ty0 = Math.max(0, Math.floor(view.y / tt));
    const tx1 = Math.min(Math.ceil(this.docW / tt), Math.ceil((view.x + view.w) / tt) + 1);
    const ty1 = Math.min(Math.ceil(this.docH / tt), Math.ceil((view.y + view.h) / tt) + 1);

    const wanted: [number, number][] = [];
    this.clock++;
    for (let ty = ty0; ty < ty1; ty++) {
      for (let tx = tx0; tx < tx1; tx++) {
        const key = `${this.part}:${this.zoom}:${tx}:${ty}`;
        const t = this.tiles.get(key);
        if (t?.image) {
          ctx.drawImage(t.image, Math.round(ox + tx * tileCss * dpr), Math.round(oy + ty * tileCss * dpr), TILE_PX, TILE_PX);
        }
        if (t) t.used = this.clock;
        if (!t || (t.stale && !t.loading) || (!t.image && !t.loading)) wanted.push([tx, ty]);
      }
    }
    // Tuiles les plus proches du centre d'abord.
    const cx = (tx0 + tx1) / 2;
    const cy = (ty0 + ty1) / 2;
    wanted.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
    for (const [tx, ty] of wanted) {
      if (this.inflight >= MAX_INFLIGHT) break;
      this.fetch(tx, ty);
    }

    this.drawOverlays(ctx, ox, oy, s * dpr);
    this.evict();
  }

  private drawOverlays(ctx: CanvasRenderingContext2D, ox: number, oy: number, k: number) {
    const r = (q: Rect) => [ox + q.x * k, oy + q.y * k, q.w * k, q.h * k] as const;
    const ov = this.overlays;
    if (ov.selection.length) {
      ctx.fillStyle = "rgba(242, 111, 0, 0.22)";
      for (const q of ov.selection) ctx.fillRect(...r(q));
    }
    if (ov.cellCursor) {
      ctx.strokeStyle = "#F26F00";
      ctx.lineWidth = 2 * this.dpr;
      ctx.strokeRect(...r(ov.cellCursor));
    }
    if (ov.graphic) {
      ctx.strokeStyle = "#F26F00";
      ctx.setLineDash([4 * this.dpr, 3 * this.dpr]);
      ctx.lineWidth = this.dpr;
      ctx.strokeRect(...r(ov.graphic));
      ctx.setLineDash([]);
    }
    if (ov.cursor && ov.cursorVisible && this.blink) {
      const [x, y, , h] = r(ov.cursor);
      ctx.fillStyle = "#000";
      ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(1.5 * this.dpr)), h);
    }
  }

  private async fetch(tx: number, ty: number) {
    const key = `${this.part}:${this.zoom}:${tx}:${ty}`;
    let t = this.tiles.get(key);
    if (!t) {
      t = { image: null, stale: false, loading: false, used: this.clock };
      this.tiles.set(key, t);
    }
    t.loading = true;
    t.stale = false;
    this.inflight++;
    const tt = this.tileTwips;
    const part = this.part;
    try {
      const px = await paint(this.doc, { px_w: TILE_PX, px_h: TILE_PX, x: tx * tt, y: ty * tt, w: tt, h: tt, part: this.partTiles ? part : undefined });
      const data = new ImageData(px, TILE_PX, TILE_PX);
      const image = typeof createImageBitmap === "function" ? await createImageBitmap(data) : toCanvas(data);
      if (this.disposed) return;
      if (t.image instanceof ImageBitmap) t.image.close();
      t.image = image;
    } catch {
      t.stale = true; // nouvel essai au prochain dessin
    } finally {
      t.loading = false;
      this.inflight--;
      this.schedule();
    }
  }

  private evict() {
    if (this.tiles.size <= MAX_CACHE) return;
    const old = [...this.tiles.entries()].filter(([, t]) => !t.loading).sort((a, b) => a[1].used - b[1].used);
    for (const [key, t] of old.slice(0, this.tiles.size - MAX_CACHE)) {
      if (t.image instanceof ImageBitmap) t.image.close();
      this.tiles.delete(key);
    }
  }
}

function toCanvas(data: ImageData): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = data.width;
  c.height = data.height;
  c.getContext("2d")!.putImageData(data, 0, 0);
  return c;
}
