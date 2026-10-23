import { describe, expect, it } from "vitest";
import { severityFor, shouldSpell, SPELL_MAX_CHARS, toDiagnostics } from "./spell";
import type { Remark } from "./api";

const remark = (r: Partial<Remark>): Remark => ({ from: 0, to: 1, category: "Spelling", severity: "Error", message: "m", suggestions: [], rule: "r", ...r });

describe("AuxiCorrect dans AuxiText", () => {
  it("colore selon la catégorie", () => {
    expect(severityFor("Spelling")).toBe("error");
    expect(severityFor("Grammar")).toBe("hint");
    expect(severityFor("Typography")).toBe("warning");
    expect(severityFor("Style")).toBe("warning");
    expect(severityFor("Regional")).toBe("warning");
  });

  it("ne vérifie que le texte brut et le Markdown, dans la limite de taille", () => {
    expect(shouldSpell("plain", true, 10)).toBe(true);
    expect(shouldSpell("markdown", true, 10)).toBe(true);
    expect(shouldSpell("rust", true, 10)).toBe(false);
    expect(shouldSpell("json", true, 10)).toBe(false);
    expect(shouldSpell("plain", false, 10)).toBe(false);
    expect(shouldSpell("plain", true, SPELL_MAX_CHARS + 1)).toBe(false);
  });

  it("transforme les remarques : suggestions, Ignorer, positions hors du texte écartées", () => {
    const text = "Les enfant jouent.";
    const ds = toDiagnostics(
      [
        remark({ from: 4, to: 10, category: "Grammar", message: "Accord", suggestions: ["enfants", "x", "y", "z", "w", "v"] }),
        remark({ from: 5, to: 99 }),
        remark({ from: 3, to: 3 }),
      ],
      text,
      new Set(),
    );
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ from: 4, to: 10, severity: "hint", message: "Accord", source: "AuxiCorrect · Grammaire" });
    expect(ds[0].actions!.map((a) => a.name)).toEqual(["enfants", "x", "y", "z", "w", "Ignorer"]);
  });

  it("une remarque ignorée ne revient pas pour le même texte", () => {
    const ignore = new Set<string>(["r\u0000fote"]);
    const text = "Une fote et une fote.";
    expect(toDiagnostics([remark({ from: 4, to: 8 }), remark({ from: 16, to: 20, rule: "autre" })], text, ignore)).toHaveLength(1);
  });
});
