import { describe, expect, it, vi } from "vitest";

// Coque simulée : chaque requête répond après un délai variable.
const log: string[] = [];
let inflight = 0;
let maxInflight = 0;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (_cmd: string, a: { doc: number; req: { cmd: string; n?: number } }) => {
    log.push(`début ${a.doc}:${a.req.cmd}${a.req.n ?? ""}`);
    inflight++;
    maxInflight = Math.max(maxInflight, inflight);
    await new Promise((r) => setTimeout(r, a.req.cmd === "save_in_place" ? 60 : 5 + ((a.req.n ?? 0) % 3) * 7));
    inflight--;
    if (a.req.cmd === "key" && a.req.n === 2) throw new Error("refusée");
    return { ok: true };
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

describe("requêtes au moteur", () => {
  it("partent dans l'ordre, une à la fois, même après une erreur", async () => {
    const { call } = await import("./engine");
    log.length = 0;
    maxInflight = 0;
    const all = [1, 2, 3, 4].map((n) => call(7, "key", { n }).catch(() => "erreur"));
    expect(await Promise.all(all)).toEqual([{ ok: true }, "erreur", { ok: true }, { ok: true }]);
    expect(log).toEqual(["début 7:key1", "début 7:key2", "début 7:key3", "début 7:key4"]);
    expect(maxInflight).toBe(1);
  });

  it("n'attendent pas la fin d'un enregistrement", async () => {
    const { call } = await import("./engine");
    log.length = 0;
    const save = call(8, "text", { n: 1 }).then(() => undefined);
    let savedDone = false;
    const saved = call(8, "save_in_place").then(() => (savedDone = true));
    await call(8, "text", { n: 2 });
    // L'enregistrement est parti après le texte qui le précède ; le texte
    // suivant a reçu sa réponse avant la fin de l'enregistrement.
    expect(log).toEqual(["début 8:text1", "début 8:save_in_place", "début 8:text2"]);
    expect(savedDone).toBe(false);
    await Promise.all([save, saved]);
  });
});
