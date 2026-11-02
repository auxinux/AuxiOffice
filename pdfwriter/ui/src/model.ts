// État d'un document et historique des modifications. Les octets du PDF ne sont
// jamais modifiés sur place : chaque état garde une référence vers les siens, ce
// qui rend Annuler et Rétablir immédiats. Aucune dépendance au DOM (testé par vitest).

import type { PageObject } from "./core/objects";

export interface PageMeta {
  /** Identifiant stable, même quand la page change de position. */
  uid: string;
  /** Change quand le contenu de la page change (miniature à refaire). */
  rev: number;
}

export interface DocState {
  bytes: Uint8Array;
  pages: PageMeta[];
  objects: Record<string, PageObject[]>;
}

let counter = 0;
export const newId = () => `p${++counter}`;
export const makePages = (n: number): PageMeta[] => Array.from({ length: n }, () => ({ uid: newId(), rev: 0 }));
export const initialState = (bytes: Uint8Array, pageCount: number): DocState => ({ bytes, pages: makePages(pageCount), objects: {} });

const MAX_STEPS = 60;
const MAX_BYTES = 800 * 1024 * 1024;

export class History {
  undoList: DocState[] = [];
  redoList: DocState[] = [];

  push(prev: DocState) {
    this.undoList.push(prev);
    this.redoList = [];
    this.trim();
  }
  private trim() {
    while (this.undoList.length > MAX_STEPS) this.undoList.shift();
    for (;;) {
      const seen = new Set<Uint8Array>();
      let total = 0;
      for (const s of this.undoList) {
        if (!seen.has(s.bytes)) {
          seen.add(s.bytes);
          total += s.bytes.length;
        }
      }
      if (total <= MAX_BYTES || this.undoList.length <= 2) break;
      this.undoList.shift();
    }
  }
  undo(cur: DocState): DocState | null {
    const s = this.undoList.pop();
    if (!s) return null;
    this.redoList.push(cur);
    return s;
  }
  redo(cur: DocState): DocState | null {
    const s = this.redoList.pop();
    if (!s) return null;
    this.undoList.push(cur);
    return s;
  }
  clear() {
    this.undoList = [];
    this.redoList = [];
  }
}

const cloneObj = (o: PageObject): PageObject => ({ ...o, id: newId() });

/** Conséquences d'un nouvel ordre de pages : pages retirées (objets perdus),
 * pages répétées (nouvel identifiant, objets recopiés). */
export function applyOrder(s: DocState, order: number[], bytes: Uint8Array): DocState {
  const seen = new Set<number>();
  const objects: Record<string, PageObject[]> = {};
  const pages = order.map((i) => {
    const p = s.pages[i];
    const list = s.objects[p.uid];
    if (seen.has(i)) {
      const uid = newId();
      if (list?.length) objects[uid] = list.map(cloneObj);
      return { uid, rev: 0 };
    }
    seen.add(i);
    if (list?.length) objects[p.uid] = list;
    return p;
  });
  return { bytes, pages, objects };
}

export function insertPagesAt(s: DocState, at: number, count: number, bytes: Uint8Array): DocState {
  const pages = [...s.pages];
  pages.splice(at, 0, ...makePages(count));
  return { ...s, bytes, pages };
}

export function touchPages(s: DocState, indices: number[], bytes: Uint8Array): DocState {
  const set = new Set(indices);
  return { ...s, bytes, pages: s.pages.map((p, i) => (set.has(i) ? { ...p, rev: p.rev + 1 } : p)) };
}

/** Objets à écrire, avec l'indice actuel de chaque page. */
export function objectsByIndex(s: DocState): [number, PageObject[]][] {
  const out: [number, PageObject[]][] = [];
  s.pages.forEach((p, i) => {
    const l = s.objects[p.uid];
    if (l?.length) out.push([i, l]);
  });
  return out;
}

/** Nouvelle position des pages après un glisser-déposer : `moved` (indices) va
 * s'insérer avant `before` (indice d'origine, ou le nombre de pages pour la fin). */
export function moveOrder(count: number, moved: number[], before: number): number[] {
  const m = new Set(moved);
  const rest: number[] = [];
  for (let i = 0; i < count; i++) if (!m.has(i)) rest.push(i);
  let at = rest.findIndex((i) => i >= before);
  if (at < 0) at = rest.length;
  const sorted = [...moved].sort((a, b) => a - b);
  rest.splice(at, 0, ...sorted);
  return rest;
}

export const isIdentity = (order: number[], count: number) => order.length === count && order.every((v, i) => v === i);
