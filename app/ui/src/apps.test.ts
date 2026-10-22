import { describe, expect, it } from "vitest";
import { APP_DOC, APP_NAMES, menusFor, ribbonFor, type MenuEntry } from "./actions";
import { recentsFor } from "./Home";
import { isExternalLink, pageSizeLabel, pdfDate, sizeLabel } from "./pdfutil";

/** Raccourcis d'une barre de menus (pour vérifier qu'ils ne se répètent pas). */
function accels(entries: MenuEntry[]): string[] {
  return entries.flatMap((e) => (e === "-" ? [] : "submenu" in e ? accels(e.items) : e.accel ? [e.accel] : []));
}

describe("applications", () => {
  it("AuxiDraw et AuxiPDF ont leur nom et leur type de document", () => {
    expect(APP_NAMES.draw).toBe("AuxiDraw");
    expect(APP_NAMES.pdf).toBe("AuxiPDF");
    expect(APP_DOC.draw).toBe("drawing");
    expect(APP_DOC.pdf).toBe("pdf");
  });

  it("chaque application ne garde que ses documents récents", () => {
    const all = ["/a/plan.odg", "/a/schema.vsdx", "/a/lettre.docx", "/a/budget.xlsm", "/a/facture.pdf", "/a/notes", "/a/cours.pptm"];
    expect(recentsFor("draw", all)).toEqual(["/a/plan.odg", "/a/schema.vsdx"]);
    expect(recentsFor("pdf", all)).toEqual(["/a/facture.pdf"]);
    expect(recentsFor("sheet", all)).toEqual(["/a/budget.xlsm"]);
    expect(recentsFor("present", all)).toEqual(["/a/cours.pptm"]);
    // Extension inconnue : AuxiWriter.
    expect(recentsFor("writer", all)).toEqual(["/a/lettre.docx", "/a/notes"]);
    expect(recentsFor("office", all)).toEqual(all);
  });
});

describe("menus", () => {
  for (const [type, app] of [["drawing", "draw"], ["pdf", "pdf"], ["text", "writer"], ["spreadsheet", "sheet"], ["presentation", "present"]] as const) {
    it(`${app} : raccourcis uniques`, () => {
      const list = menusFor(type, app).flatMap((m) => accels(m.items));
      expect(list.length).toBeGreaterThan(2);
      expect(new Set(list).size).toBe(list.length);
    });
  }

  it("AuxiDraw a ses menus de dessin et son ruban", () => {
    const labels = menusFor("drawing", "draw").map((m) => m.label);
    expect(labels).toEqual(["Fichier", "Édition", "Affichage", "Insertion", "Format", "Disposition", "Page", "Outils"]);
    expect(ribbonFor("drawing").map((t) => t.label)).toContain("Disposition");
  });

  it("AuxiPDF n'a pas de « Nouveau » à l'accueil", () => {
    const file = menusFor(null, "pdf")[0];
    expect(JSON.stringify(file)).not.toContain("Nouveau");
    expect(menusFor("pdf", "pdf").map((m) => m.label)).toEqual(["Fichier", "Édition", "Affichage", "Aller", "Annoter"]);
  });
});

describe("AuxiPDF", () => {
  it("lit les dates PDF", () => {
    expect(pdfDate("D:20260115093000-05'00'")).toBe("2026-01-15 09:30");
    expect(pdfDate("D:2026")).toBe("2026-01-01 00:00");
    expect(pdfDate(undefined)).toBe("");
  });

  it("nomme les formats de page", () => {
    expect(pageSizeLabel(612, 792)).toContain("Lettre US");
    expect(pageSizeLabel(841.89, 595.28)).toContain("A4, paysage");
    expect(pageSizeLabel(612, 792)).toContain("216 × 279 mm");
  });

  it("écrit les tailles de fichier", () => {
    expect(sizeLabel(500)).toBe("500 octets");
    expect(sizeLabel(1536)).toBe("1,5 Ko");
    expect(sizeLabel(3 * 1024 * 1024)).toBe("3 Mo");
  });

  it("n'ouvre que les liens web et courriel", () => {
    expect(isExternalLink("https://office.auxinux.ca")).toBe(true);
    expect(isExternalLink("mailto:info@auxinux.ca")).toBe(true);
    expect(isExternalLink("javascript:alert(1)")).toBe(false);
    expect(isExternalLink("file:///etc/passwd")).toBe(false);
  });
});
