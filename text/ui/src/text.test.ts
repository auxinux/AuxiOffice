import { describe, expect, it } from "vitest";
import { accelToKey, flatItems, menuBar } from "./actions";
import { ENCODINGS, encodingLabel, eolShort } from "./encodings";
import { defaultExtension, detectLanguage, LANGUAGES, languageFromFirstLine } from "./languages";
import { DEFAULT_PREFS, effectiveFontSize, fontStack, isDark, nextZoom, sanitizePrefs } from "./prefs";
import { detectIndent, dirName, displayPath, fileName, humanSize, sortLines, textStats, trimTrailing } from "./util";

describe("détection du langage", () => {
  const cases: [string, string][] = [
    ["/home/a/notes.txt", "plain"],
    ["/home/a/LISEZMOI", "plain"],
    ["/home/a/README.md", "markdown"],
    ["/projet/Makefile", "makefile"],
    ["/projet/GNUmakefile", "makefile"],
    ["/projet/Makefile.am", "makefile"],
    ["/projet/Makefile.in", "makefile"],
    ["/projet/regles.mk", "makefile"],
    ["/projet/Dockerfile", "dockerfile"],
    ["/projet/Dockerfile.dev", "dockerfile"],
    ["/projet/Containerfile", "dockerfile"],
    ["/home/a/.bashrc", "shell"],
    ["/home/a/.bash_aliases", "shell"],
    ["/home/a/.profile", "shell"],
    ["/home/a/.zshrc", "shell"],
    ["/projet/.env", "shell"],
    ["/projet/.env.local", "shell"],
    ["/projet/PKGBUILD", "shell"],
    ["/projet/install.sh", "shell"],
    ["/projet/CMakeLists.txt", "cmake"],
    ["/projet/Cargo.toml", "toml"],
    ["/projet/Cargo.lock", "toml"],
    ["/projet/package.json", "json"],
    ["/projet/.babelrc", "json"],
    ["/projet/docker-compose.yml", "yaml"],
    ["/projet/.clang-format", "yaml"],
    ["/projet/main.rs", "rust"],
    ["/projet/main.c", "cpp"],
    ["/projet/main.HPP", "cpp"],
    ["/projet/App.tsx", "typescript"],
    ["/projet/index.ts", "typescript"],
    ["/projet/index.mjs", "javascript"],
    ["/projet/setup.py", "python"],
    ["/projet/SConstruct", "python"],
    ["/projet/Rakefile", "ruby"],
    ["/projet/Gemfile", "ruby"],
    ["/projet/index.html", "html"],
    ["/projet/style.scss", "css"],
    ["/projet/schema.sql", "sql"],
    ["/projet/fix.patch", "diff"],
    ["/etc/systemd/system/a.service", "ini"],
    ["/usr/share/applications/ca.auxinux.AuxiText.desktop", "ini"],
    ["/home/a/.gitconfig", "ini"],
    ["/home/a/.editorconfig", "ini"],
    ["/etc/nginx/sites-available/site.conf", "nginx"],
    ["/etc/nginx/nginx.conf", "nginx"],
    ["/var/log/syslog", "log"],
    ["/var/log/auth.log", "log"],
    ["/var/log/Xorg.0.log", "log"],
    ["/etc/fstab.bak", "plain"],
    ["/etc/ssh/sshd_config.dpkg-old", "plain"],
    ["/home/a/script.sh~", "shell"],
    ["/home/a/config.yaml.orig", "yaml"],
    ["/projet/config.h.in", "cpp"],
    ["C:\\Users\\a\\notes.ini", "ini"],
    ["/projet/api.proto", "protobuf"],
    ["/projet/main.go", "go"],
  ];
  for (const [path, id] of cases) {
    it(`${path} → ${id}`, () => expect(detectLanguage(path)).toBe(id));
  }

  it("première ligne : #!, <?xml, <!DOCTYPE html, diff", () => {
    expect(detectLanguage("/usr/local/bin/outil", "#!/bin/bash")).toBe("shell");
    expect(detectLanguage("/usr/local/bin/outil", "#!/usr/bin/env python3")).toBe("python");
    expect(detectLanguage("/usr/local/bin/outil", "#!/usr/bin/env -S node --experimental")).toBe("javascript");
    expect(detectLanguage(null, "#!/usr/bin/perl -w")).toBe("perl");
    expect(detectLanguage(null, "#!/bin/sh")).toBe("shell");
    expect(detectLanguage(null, "#!/usr/bin/make -f")).toBe("makefile");
    expect(detectLanguage("/tmp/donnees", '<?xml version="1.0"?>')).toBe("xml");
    expect(detectLanguage("/tmp/page", "<!DOCTYPE html>")).toBe("html");
    expect(detectLanguage("/tmp/x", "diff --git a/b c/d")).toBe("diff");
    expect(languageFromFirstLine("Bonjour")).toBeNull();
    expect(languageFromFirstLine("#!/opt/inconnu")).toBeNull();
    // L'extension l'emporte sur la première ligne.
    expect(detectLanguage("/a/b.py", "#!/bin/sh")).toBe("python");
  });

  it("traductions Qt (.ts XML) : XML", () => {
    expect(detectLanguage("/a/auxitext_fr.ts", '<?xml version="1.0" encoding="utf-8"?>')).toBe("xml");
    expect(detectLanguage("/a/index.ts", "import x from 'y';")).toBe("typescript");
  });

  it("chaque langage a un identifiant unique, un nom, et un chargeur sauf le texte brut", () => {
    const ids = LANGUAGES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of LANGUAGES) {
      expect(l.name.length).toBeGreaterThan(0);
      if (l.id !== "plain") expect(typeof l.load).toBe("function");
    }
    // Une extension n'appartient qu'à un langage.
    const seen = new Map<string, string>();
    for (const l of LANGUAGES) for (const e of l.ext ?? []) {
      expect(seen.get(e), `.${e} : ${seen.get(e)} et ${l.id}`).toBeUndefined();
      seen.set(e, l.id);
    }
  });

  it("extension proposée à l'enregistrement", () => {
    expect(defaultExtension("plain")).toBe("txt");
    expect(defaultExtension("markdown")).toBe("md");
    expect(defaultExtension("typescript")).toBe("ts");
    expect(defaultExtension("nginx")).toBe("txt");
  });
});

describe("préférences", () => {
  it("valeurs par défaut pour un fichier absent ou abîmé", () => {
    expect(sanitizePrefs(undefined)).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs("n'importe quoi")).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs({ theme: "violet", fontSize: "grand", wrap: "oui", indentWidth: 2.5 })).toEqual(DEFAULT_PREFS);
  });

  it("valeurs gardées et bornées", () => {
    const p = sanitizePrefs({ theme: "dark", fontSize: 500, zoom: 9, wrap: false, indentWithTabs: true, indentWidth: 8, fontFamily: "Hack; } body { color: red" });
    expect(p.theme).toBe("dark");
    expect(p.fontSize).toBe(72);
    expect(p.zoom).toBe(4);
    expect(p.wrap).toBe(false);
    expect(p.indentWithTabs).toBe(true);
    expect(p.indentWidth).toBe(8);
    expect(p.fontFamily).not.toMatch(/[;{}]/);
    expect(sanitizePrefs({ fontSize: 1 }).fontSize).toBe(6);
  });

  it("zoom", () => {
    expect(nextZoom(1, 1)).toBe(1.1);
    expect(nextZoom(1, -1)).toBe(0.9);
    expect(nextZoom(1.7, 0)).toBe(1);
    expect(nextZoom(4, 1)).toBe(4);
    expect(nextZoom(0.5, -1)).toBe(0.5);
    let z = 1;
    for (let i = 0; i < 3; i++) z = nextZoom(z, 1);
    expect(z).toBe(1.3);
    expect(effectiveFontSize({ ...DEFAULT_PREFS, fontSize: 14, zoom: 1.5 })).toBe(21);
  });

  it("police et thème", () => {
    expect(fontStack(DEFAULT_PREFS)).toContain("monospace");
    expect(fontStack({ ...DEFAULT_PREFS, fontFamily: "Noto Sans Mono" }).startsWith('"Noto Sans Mono",')).toBe(true);
    expect(isDark("system", true)).toBe(true);
    expect(isDark("system", false)).toBe(false);
    expect(isDark("system", null)).toBe(false);
    expect(isDark("light", true)).toBe(false);
    expect(isDark("dark", false)).toBe(true);
  });
});

describe("indentation", () => {
  it("espaces : largeur la plus fréquente", () => {
    const two = "a:\n  b:\n    c: 1\n  d: 2\ne:\n  f: 3\n";
    expect(detectIndent(two)).toEqual({ tabs: false, width: 2 });
    const four = "def f():\n    if x:\n        return 1\n    return 2\n\nclass A:\n    pass\n";
    expect(detectIndent(four)).toEqual({ tabs: false, width: 4 });
  });

  it("tabulations, sans indentation, commentaires en bloc", () => {
    expect(detectIndent("int main() {\n\tif (a) {\n\t\treturn 1;\n\t}\n}\n")).toEqual({ tabs: true, width: 0 });
    expect(detectIndent("pas\nd'indentation\n")).toBeNull();
    expect(detectIndent("")).toBeNull();
    const js = "/**\n * doc\n * suite\n */\nfunction f() {\n    return 1;\n}\nfunction g() {\n    return 2;\n}\n";
    expect(detectIndent(js)).toEqual({ tabs: false, width: 4 });
  });
});

describe("encodages", () => {
  it("libellés", () => {
    expect(encodingLabel("UTF-8", false)).toBe("UTF-8");
    expect(encodingLabel("UTF-8", true)).toBe("UTF-8 avec BOM");
    expect(encodingLabel("UTF-16LE", true)).toBe("UTF-16 LE");
    expect(encodingLabel("UTF-16BE", false)).toBe("UTF-16 BE sans BOM");
    expect(encodingLabel("windows-1252", false)).toBe("Windows-1252");
    expect(encodingLabel("ISO-8859-15", false)).toBe("ISO-8859-15");
    expect(eolShort("crlf")).toBe("CRLF");
  });

  it("liste sans doublons", () => {
    const keys = ENCODINGS.map((e) => `${e.encoding}|${e.bom}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("menus", () => {
  const defs = menuBar({ writer: true });
  const items = flatItems(defs);

  it("identifiants et raccourcis uniques", () => {
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    const accels = items.filter((i) => i.accel).map((i) => i.accel);
    expect(new Set(accels).size).toBe(accels.length);
  });

  it("raccourcis usuels présents", () => {
    const accel = (id: string) => items.find((i) => i.id === id)?.accel;
    expect(accel("new")).toBe("CmdOrCtrl+N");
    expect(accel("open")).toBe("CmdOrCtrl+O");
    expect(accel("save")).toBe("CmdOrCtrl+S");
    expect(accel("saveAs")).toBe("CmdOrCtrl+Shift+S");
    expect(accel("closeTab")).toBe("CmdOrCtrl+W");
    expect(accel("find")).toBe("CmdOrCtrl+F");
    expect(accel("replace")).toBe("CmdOrCtrl+H");
    expect(accel("gotoLine")).toBe("CmdOrCtrl+G");
    expect(accel("undo")).toBe("CmdOrCtrl+Z");
    expect(accel("redo")).toBe("CmdOrCtrl+Y");
    expect(accel("zoomReset")).toBe("CmdOrCtrl+0");
  });

  it("AuxiWriter seulement si la suite est installée", () => {
    expect(items.some((i) => i.id === "openInWriter")).toBe(true);
    expect(flatItems(menuBar({ writer: false })).some((i) => i.id === "openInWriter")).toBe(false);
  });

  it("raccourcis au format CodeMirror", () => {
    expect(accelToKey("CmdOrCtrl+Shift+S")).toBe("Mod-Shift-s");
    expect(accelToKey("CmdOrCtrl+-")).toBe("Mod--");
    expect(accelToKey("Shift+F3")).toBe("Shift-F3");
    expect(accelToKey("Alt+Up")).toBe("Alt-ArrowUp");
    expect(accelToKey("CmdOrCtrl+/")).toBe("Mod-/");
  });
});

describe("utilitaires", () => {
  it("chemins", () => {
    expect(fileName("/home/a/b.txt")).toBe("b.txt");
    expect(fileName("C:\\a\\b.txt")).toBe("b.txt");
    expect(dirName("/home/a/b.txt")).toBe("/home/a");
    expect(dirName("/b.txt")).toBe("/");
    expect(dirName("b.txt")).toBe("");
    expect(displayPath("/home/a/doc/x.txt", "/home/a")).toBe("~/doc/x.txt");
    expect(displayPath("/home/ab/x.txt", "/home/a")).toBe("/home/ab/x.txt");
  });

  it("tri naturel et en français", () => {
    expect(sortLines(["élan", "Zèbre", "abeille", "fichier10", "fichier2"])).toEqual(["abeille", "élan", "fichier2", "fichier10", "Zèbre"]);
    expect(sortLines(["a", "c", "b"], true)).toEqual(["c", "b", "a"]);
  });

  it("espaces de fin, tailles, statistiques", () => {
    expect(trimTrailing("a  \nb\t\n c ")).toBe("a\nb\n c");
    expect(humanSize(512)).toBe("512 octets");
    expect(humanSize(1536)).toMatch(/^1,5 Ko$/);
    expect(humanSize(52 * 1024 * 1024)).toBe("52 Mo");
    expect(textStats("Bonjour l'été !\nDeux lignes")).toEqual({ lines: 2, words: 4, chars: 27, charsNoSpaces: 23 });
    expect(textStats("").lines).toBe(1);
  });
});
