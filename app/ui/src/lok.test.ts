import { describe, expect, it } from "vitest";
import { KEY, colorToLong, intersects, isUntitled, lokKeyFor, parseInvalidation, parseRects, parseState, unoArgs } from "./lok";

const key = (k: Partial<Parameters<typeof lokKeyFor>[0]>) => ({ key: "", code: "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...k });

describe("rectangles", () => {
  it("lit un ou plusieurs rectangles", () => {
    expect(parseRects("1, 2, 3, 4")).toEqual([{ x: 1, y: 2, w: 3, h: 4 }]);
    expect(parseRects("1, 2, 3, 4; 5, 6, 7, 8")).toHaveLength(2);
    expect(parseRects("EMPTY")).toEqual([]);
    expect(parseRects("")).toEqual([]);
  });

  it("lit les invalidations", () => {
    expect(parseInvalidation("EMPTY")).toEqual({ rect: null, part: null });
    expect(parseInvalidation("EMPTY, 2")).toEqual({ rect: null, part: 2 });
    expect(parseInvalidation("10, 20, 30, 40, 1, 0")).toEqual({ rect: { x: 10, y: 20, w: 30, h: 40 }, part: 1 });
    expect(parseInvalidation("0, 0, 1000000000, 1000000000").rect).toBeNull();
  });

  it("détecte les chevauchements", () => {
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
  });
});

describe("états", () => {
  it("lit les deux formes de state_changed", () => {
    expect(parseState(".uno:Bold=true")).toEqual({ command: ".uno:Bold", value: "true" });
    expect(parseState(".uno:CharFontName=Liberation Serif")).toEqual({ command: ".uno:CharFontName", value: "Liberation Serif" });
    expect(parseState('{"commandName":".uno:Undo","state":"enabled"}')).toEqual({ command: ".uno:Undo", value: "enabled" });
    expect(parseState("n'importe quoi")).toBeNull();
  });
});

describe("touches", () => {
  it("laisse passer les caractères ordinaires vers la saisie de texte", () => {
    expect(lokKeyFor(key({ key: "é", code: "Digit2" }))).toBeNull();
    expect(lokKeyFor(key({ key: "A", code: "KeyA", shiftKey: true }))).toBeNull();
  });

  it("traduit la navigation et l'édition", () => {
    expect(lokKeyFor(key({ key: "Enter", code: "Enter" }))).toEqual({ char: 13, code: KEY.RETURN });
    expect(lokKeyFor(key({ key: "ArrowLeft", code: "ArrowLeft", shiftKey: true }))).toEqual({ char: 0, code: KEY.LEFT | KEY.SHIFT });
    expect(lokKeyFor(key({ key: "Backspace", code: "Backspace" }))).toEqual({ char: 8, code: KEY.BACKSPACE });
    expect(lokKeyFor(key({ key: "F2", code: "F2" }))).toEqual({ char: 0, code: KEY.F1 + 1 });
  });

  it("traduit les raccourcis selon la touche physique", () => {
    expect(lokKeyFor(key({ key: "b", code: "KeyB", ctrlKey: true }))).toEqual({ char: 0, code: (KEY.A + 1) | KEY.MOD1 });
    // Clavier AZERTY : Ctrl + touche physique « KeyQ » qui affiche « a ».
    expect(lokKeyFor(key({ key: "a", code: "KeyQ", ctrlKey: true }))?.code).toBe((KEY.A + 16) | KEY.MOD1);
    expect(lokKeyFor(key({ key: "End", code: "End", ctrlKey: true }))).toEqual({ char: 0, code: KEY.END | KEY.MOD1 });
  });

  it("utilise Cmd comme touche principale sous macOS", () => {
    expect(lokKeyFor(key({ key: "s", code: "KeyS", metaKey: true }), true)?.code).toBe((KEY.A + 18) | KEY.MOD1);
    expect(lokKeyFor(key({ key: "s", code: "KeyS", ctrlKey: true }), true)?.code).toBe((KEY.A + 18) | KEY.MOD3);
  });
});

describe("divers", () => {
  it("convertit couleurs et arguments UNO", () => {
    expect(colorToLong("#ff0000")).toBe(0xff0000);
    expect(unoArgs({ Bold: true, Height: 12.5, Size: 3, Name: "Arial" })).toEqual({
      Bold: { type: "boolean", value: true },
      Height: { type: "float", value: 12.5 },
      Size: { type: "long", value: 3 },
      Name: { type: "string", value: "Arial" },
    });
  });

  it("reconnaît les documents sans titre", () => {
    expect(isUntitled("/tmp/AuxiOffice/Sans titre 1760000000000.docx")).toBe(true);
    expect(isUntitled("C:\\Users\\a\\AppData\\Local\\Temp\\AuxiOffice\\Sans titre 17.xlsx")).toBe(true);
    expect(isUntitled("/home/a/Documents/rapport.docx")).toBe(false);
  });
});

describe("URL de fichiers", () => {
  it("encode les chemins Unix et Windows", async () => {
    const { toFileUrl } = await import("./lok");
    expect(toFileUrl("/home/a/Mes images/été.png")).toBe("file:///home/a/Mes%20images/%C3%A9t%C3%A9.png");
    expect(toFileUrl("C:\\Users\\a\\photo 1.jpg")).toBe("file:///C:/Users/a/photo%201.jpg");
  });
});

describe("menu contextuel", () => {
  it("nettoie le menu de LibreOffice", async () => {
    const { cleanMenu, menuLabel } = await import("./ContextMenu");
    expect(menuLabel("Tout i~gnorer")).toBe("Tout ignorer");
    const items = cleanMenu([
      { type: "separator" },
      { type: "command", text: "~Couper", command: ".uno:Cut", enabled: "true" },
      { type: "command", text: "Inactif", command: ".uno:X", enabled: "false" },
      { type: "separator" },
      { type: "separator" },
      { type: "menu", text: "Vide", menu: [{ type: "command", text: "x", command: ".uno:Y", enabled: "false" }] },
      { type: "command", text: "Coller", command: ".uno:Paste", enabled: "true" },
      { type: "separator" },
    ]);
    expect(items.map((i) => i.text ?? "-")).toEqual(["~Couper", "-", "Coller"]);
  });
});

describe("impression", () => {
  it("valide les plages de pages", async () => {
    const { validPageRange } = await import("./PrintDialog");
    expect(validPageRange("")).toBe(true);
    expect(validPageRange("1-3, 5")).toBe(true);
    expect(validPageRange("2;4-6")).toBe(true);
    expect(validPageRange("0")).toBe(false);
    expect(validPageRange("1-")).toBe(false);
    expect(validPageRange("a")).toBe(false);
  });
});

describe("saisie composée", () => {
  it("ignore les « input » d'une composition (touches mortes)", async () => {
    const { isCompositionInput } = await import("./lok");
    // Séquence de WebKitGTK pour ^ puis e : seul compositionend porte « ê ».
    expect(isCompositionInput({ inputType: "insertCompositionText", isComposing: true })).toBe(true);
    expect(isCompositionInput({ inputType: "deleteCompositionText", isComposing: true })).toBe(true);
    expect(isCompositionInput({ inputType: "insertFromComposition", isComposing: true })).toBe(true);
    expect(isCompositionInput({ inputType: "insertFromComposition", isComposing: false })).toBe(true);
    expect(isCompositionInput({ inputType: "insertText", isComposing: false })).toBe(false);
    expect(isCompositionInput({})).toBe(false);
  });
});

describe("documents chiffrés", () => {
  it("reconnaît les erreurs de mot de passe du moteur", async () => {
    const { passwordError } = await import("./PasswordDialog");
    expect(passwordError("mot de passe requis")).toBe("requis");
    expect(passwordError(new Error("mot de passe incorrect"))).toBe(null); // « Error: … »
    expect(passwordError("mot de passe incorrect")).toBe("incorrect");
    expect(passwordError("Unsupported URL")).toBe(null);
  });
});

describe("presse-papiers", () => {
  it("reconnaît sa propre copie malgré les fins de ligne", async () => {
    const { sameClipboardText } = await import("./lok");
    expect(sameClipboardText("a\r\nb\r\n", "a\nb")).toBe(true);
    expect(sameClipboardText("", "")).toBe(true);
    expect(sameClipboardText("a b", "a  b")).toBe(false);
  });
});

describe("enregistrer sous", () => {
  const filters = [
    { name: "Document Word", extensions: ["docx"] },
    { name: "Document Word avec macros", extensions: ["docm"] },
    { name: "Texte OpenDocument", extensions: ["odt"] },
  ];
  it("propose d'abord le format du document (macros conservées)", async () => {
    const { saveFiltersFor } = await import("./lok");
    expect(saveFiltersFor(filters, "/home/a/Lettre de l'été.DOCM")[0].extensions).toEqual(["docm"]);
    expect(saveFiltersFor(filters, "C:\\Docs\\x.odt").map((f) => f.extensions[0])).toEqual(["odt", "docx", "docm"]);
    expect(saveFiltersFor(filters, "/a/notes.txt")).toBe(filters);
    expect(saveFiltersFor(filters, "")).toBe(filters);
  });
  it("ouvre la boîte à côté du document", async () => {
    const { besideFile } = await import("./lok");
    expect(besideFile("/home/a/Lettre l'été.docx", "Lettre l'été.pdf")).toBe("/home/a/Lettre l'été.pdf");
    expect(besideFile("C:\\Docs\\x.docx", "x.pdf")).toBe("C:\\Docs\\x.pdf");
    expect(besideFile("x.docx", "x.pdf")).toBe("x.pdf");
  });
  it("ajoute l'extension manquante", async () => {
    const { withSaveExtension } = await import("./lok");
    expect(withSaveExtension("/home/a/rapport", filters)).toBe("/home/a/rapport.docx");
    expect(withSaveExtension("/home/a/rapport.v2", filters)).toBe("/home/a/rapport.v2.docx");
    expect(withSaveExtension("/home/a/rapport.DocM", filters)).toBe("/home/a/rapport.DocM");
    expect(withSaveExtension("/home/a.b/rapport", [{ name: "PDF", extensions: ["pdf"] }])).toBe("/home/a.b/rapport.pdf");
  });
});
