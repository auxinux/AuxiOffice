import { describe, expect, it } from "vitest";
import type { PageObject } from "./core/objects";
import { applyOrder, History, initialState, insertPagesAt, isIdentity, moveOrder, objectsByIndex, touchPages } from "./model";

const obj = (id: string): PageObject => ({ id, kind: "whiteout", x: 0, y: 0, w: 1, h: 1, angle: 0, color: [1, 1, 1] });
const b = (n: number) => new Uint8Array(n);

describe("historique", () => {
  it("annule et rétablit", () => {
    const h = new History();
    const a = initialState(b(1), 1);
    const c = { ...a, bytes: b(2) };
    h.push(a);
    expect(h.undo(c)).toBe(a);
    expect(h.redo(a)).toBe(c);
    expect(h.redo(c)).toBeNull();
    h.undo(c);
    h.push(a);
    expect(h.redoList).toEqual([]);
  });
  it("limite la mémoire, en comptant une seule fois les octets partagés", () => {
    const h = new History();
    const big = initialState(b(500 * 1024 * 1024), 1);
    for (let i = 0; i < 5; i++) h.push({ ...big });
    expect(h.undoList.length).toBe(5);
    const other = () => initialState(new Uint8Array(1), 1);
    for (let i = 0; i < 100; i++) h.push(other());
    expect(h.undoList.length).toBe(60);
  });
});

describe("pages et objets", () => {
  it("les objets suivent leur page", () => {
    const s = initialState(b(1), 3);
    const [p0, p1, p2] = s.pages.map((p) => p.uid);
    s.objects[p0] = [obj("a")];
    s.objects[p2] = [obj("c")];
    const r = applyOrder(s, [2, 0], b(2));
    expect(r.pages.map((p) => p.uid)).toEqual([p2, p0]);
    expect(objectsByIndex(r).map(([i, l]) => [i, l[0].id])).toEqual([[0, "c"], [1, "a"]]);
    expect(r.objects[p1]).toBeUndefined();
  });
  it("une page dupliquée reçoit une copie de ses objets", () => {
    const s = initialState(b(1), 1);
    s.objects[s.pages[0].uid] = [obj("a")];
    const r = applyOrder(s, [0, 0], b(2));
    expect(r.pages[0].uid).not.toBe(r.pages[1].uid);
    const [x, y] = objectsByIndex(r);
    expect(x[1][0].id).toBe("a");
    expect(y[1][0].id).not.toBe("a");
  });
  it("insère et marque les pages modifiées", () => {
    const s = initialState(b(1), 2);
    const r = insertPagesAt(s, 1, 2, b(2));
    expect(r.pages.length).toBe(4);
    expect(r.pages[0]).toBe(s.pages[0]);
    expect(r.pages[3]).toBe(s.pages[1]);
    const t = touchPages(s, [1], b(3));
    expect(t.pages.map((p) => p.rev)).toEqual([0, 1]);
  });
  it("calcule le déplacement", () => {
    expect(moveOrder(4, [0], 3)).toEqual([1, 2, 0, 3]);
    expect(moveOrder(4, [3], 0)).toEqual([3, 0, 1, 2]);
    expect(moveOrder(4, [1, 2], 4)).toEqual([0, 3, 1, 2]);
    expect(moveOrder(4, [0, 2], 2)).toEqual([1, 0, 2, 3]);
    expect(isIdentity(moveOrder(4, [1], 2), 4)).toBe(true);
    expect(isIdentity(moveOrder(4, [1], 1), 4)).toBe(true);
  });
});
