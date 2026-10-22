// Langages reconnus : détection d'après le nom du fichier (extension, noms
// connus comme Makefile ou .bashrc) et la première ligne (#!/bin/sh, <?xml…).
// La coloration de chaque langage est chargée à la demande (import
// dynamique) : l'ouverture d'un fichier texte ne charge aucun analyseur.

import type { Extension } from "@codemirror/state";

export interface LangDef {
  id: string;
  name: string;
  /** Extensions, sans le point, en minuscules. */
  ext?: string[];
  /** Noms de fichiers exacts (sensibles à la casse sauf indication). */
  names?: string[];
  /** Préfixes de noms (Dockerfile.dev, Makefile.am…). */
  prefixes?: string[];
  /** Interpréteur de la ligne #! (sans chemin ni version). */
  interpreters?: string[];
  load?: () => Promise<Extension>;
}

const legacy = async (p: Promise<{ [k: string]: unknown }>, key: string): Promise<Extension> => {
  const [{ StreamLanguage }, mod] = await Promise.all([import("@codemirror/language"), p]);
  return StreamLanguage.define(mod[key] as never);
};

export const LANGUAGES: LangDef[] = [
  { id: "plain", name: "Texte brut", ext: ["txt", "text"] },
  {
    id: "markdown",
    name: "Markdown",
    ext: ["md", "markdown", "mkd", "mdown", "mdwn", "mkdn"],
    load: async () => (await import("@codemirror/lang-markdown")).markdown(),
  },
  {
    id: "json",
    name: "JSON",
    ext: ["json", "jsonc", "json5", "geojson", "webmanifest", "jsonl", "ndjson", "har", "ipynb"],
    names: [".babelrc", ".eslintrc", ".prettierrc", "composer.lock", ".jshintrc"],
    load: async () => (await import("@codemirror/lang-json")).json(),
  },
  {
    id: "xml",
    name: "XML",
    ext: ["xml", "xsd", "xsl", "xslt", "svg", "plist", "xaml", "csproj", "vbproj", "ui", "glade", "kml", "gpx", "rss", "atom", "wsdl", "xul", "qrc", "metainfo", "appdata", "fodt", "fods", "fodp"],
    load: async () => (await import("@codemirror/lang-xml")).xml(),
  },
  {
    id: "html",
    name: "HTML",
    ext: ["html", "htm", "xhtml", "shtml", "vue", "svelte"],
    load: async () => (await import("@codemirror/lang-html")).html(),
  },
  {
    id: "css",
    name: "CSS",
    ext: ["css", "scss", "less", "qss"],
    load: async () => (await import("@codemirror/lang-css")).css(),
  },
  {
    id: "javascript",
    name: "JavaScript",
    ext: ["js", "mjs", "cjs", "jsx"],
    interpreters: ["node", "nodejs", "deno", "bun"],
    load: async () => (await import("@codemirror/lang-javascript")).javascript({ jsx: true }),
  },
  {
    id: "typescript",
    name: "TypeScript",
    ext: ["mts", "cts", "tsx"],
    load: async () => (await import("@codemirror/lang-javascript")).javascript({ typescript: true, jsx: true }),
  },
  {
    id: "python",
    name: "Python",
    ext: ["py", "pyw", "pyi", "pyx", "gyp", "bzl"],
    names: ["SConstruct", "SConscript", "BUILD", "WORKSPACE", "Snakefile"],
    interpreters: ["python", "python2", "python3", "pypy", "pypy3"],
    load: async () => (await import("@codemirror/lang-python")).python(),
  },
  { id: "rust", name: "Rust", ext: ["rs"], load: async () => (await import("@codemirror/lang-rust")).rust() },
  {
    id: "cpp",
    name: "C / C++",
    ext: ["c", "h", "cpp", "cc", "cxx", "c++", "hpp", "hh", "hxx", "h++", "ino", "inl", "ipp", "tpp", "m", "mm", "cu", "glsl", "vert", "frag"],
    load: async () => (await import("@codemirror/lang-cpp")).cpp(),
  },
  { id: "java", name: "Java", ext: ["java", "jav"], load: async () => (await import("@codemirror/lang-java")).java() },
  {
    id: "php",
    name: "PHP",
    ext: ["php", "phtml", "php3", "php4", "php5", "php7", "phps", "inc"],
    interpreters: ["php"],
    load: async () => (await import("@codemirror/lang-php")).php(),
  },
  { id: "sql", name: "SQL", ext: ["sql", "ddl", "dml", "psql", "mysql", "sqlite"], load: async () => (await import("@codemirror/lang-sql")).sql() },
  {
    id: "yaml",
    name: "YAML",
    ext: ["yaml", "yml", "sls"],
    names: [".clang-format", ".clang-tidy", ".yamllint"],
    load: async () => (await import("@codemirror/lang-yaml")).yaml(),
  },
  { id: "go", name: "Go", ext: ["go"], load: async () => (await import("@codemirror/lang-go")).go() },
  {
    id: "shell",
    name: "Shell (Bash)",
    ext: ["sh", "bash", "zsh", "ksh", "csh", "tcsh", "fish", "ebuild", "eclass", "bats", "command", "env"],
    names: [
      ".bashrc", ".bash_profile", ".bash_login", ".bash_logout", ".bash_aliases", ".bash_functions", ".profile",
      ".zshrc", ".zprofile", ".zshenv", ".zlogin", ".zlogout", ".kshrc", ".xprofile", ".xsession", ".xinitrc",
      "bashrc", "profile", "PKGBUILD", "APKBUILD", ".env", "configure", "gradlew", ".envrc",
    ],
    prefixes: [".env."],
    interpreters: ["sh", "bash", "zsh", "ksh", "dash", "ash", "mksh", "csh", "tcsh", "busybox"],
    load: () => legacy(import("@codemirror/legacy-modes/mode/shell"), "shell"),
  },
  {
    id: "ini",
    name: "INI / Propriétés",
    ext: ["ini", "cfg", "conf", "cnf", "properties", "prop", "desktop", "directory", "service", "socket", "timer", "mount", "automount", "target", "path", "slice", "network", "netdev", "link", "inf", "reg", "lnk", "url", "theme", "kdeglobals", "colors", "repo", "pls"],
    names: [".editorconfig", ".gitconfig", ".gitmodules", ".npmrc", ".pypirc", ".hgrc", "config", "kdeglobals", "kwinrc", "mimeapps.list", "gitconfig"],
    load: () => legacy(import("@codemirror/legacy-modes/mode/properties"), "properties"),
  },
  {
    id: "toml",
    name: "TOML",
    ext: ["toml"],
    names: ["Cargo.lock", "Pipfile", "poetry.lock", "uv.lock"],
    load: () => legacy(import("@codemirror/legacy-modes/mode/toml"), "toml"),
  },
  {
    id: "diff",
    name: "Diff / Patch",
    ext: ["diff", "patch", "rej", "debdiff"],
    load: () => legacy(import("@codemirror/legacy-modes/mode/diff"), "diff"),
  },
  {
    id: "dockerfile",
    name: "Dockerfile",
    ext: ["dockerfile", "containerfile"],
    names: ["Dockerfile", "Containerfile"],
    prefixes: ["Dockerfile.", "Containerfile."],
    load: () => legacy(import("@codemirror/legacy-modes/mode/dockerfile"), "dockerFile"),
  },
  {
    id: "makefile",
    name: "Makefile",
    ext: ["mk", "mak", "make"],
    names: ["Makefile", "makefile", "GNUmakefile", "Kbuild", "Kconfig"],
    prefixes: ["Makefile."],
    interpreters: ["make"],
    load: async () => {
      const [{ StreamLanguage }, { makefile }] = await Promise.all([import("@codemirror/language"), import("./makefile")]);
      return StreamLanguage.define(makefile);
    },
  },
  {
    id: "cmake",
    name: "CMake",
    ext: ["cmake"],
    names: ["CMakeLists.txt", "CMakeCache.txt"],
    load: () => legacy(import("@codemirror/legacy-modes/mode/cmake"), "cmake"),
  },
  { id: "lua", name: "Lua", ext: ["lua", "rockspec"], interpreters: ["lua", "luajit"], load: () => legacy(import("@codemirror/legacy-modes/mode/lua"), "lua") },
  { id: "perl", name: "Perl", ext: ["pl", "pm", "pod", "t", "psgi"], interpreters: ["perl", "perl5"], load: () => legacy(import("@codemirror/legacy-modes/mode/perl"), "perl") },
  {
    id: "ruby",
    name: "Ruby",
    ext: ["rb", "gemspec", "rake", "ru", "erb"],
    names: ["Rakefile", "Gemfile", "Vagrantfile", "Guardfile", "Podfile", "Brewfile"],
    interpreters: ["ruby"],
    load: () => legacy(import("@codemirror/legacy-modes/mode/ruby"), "ruby"),
  },
  { id: "powershell", name: "PowerShell", ext: ["ps1", "psm1", "psd1"], interpreters: ["pwsh", "powershell"], load: () => legacy(import("@codemirror/legacy-modes/mode/powershell"), "powerShell") },
  {
    id: "nginx",
    name: "Nginx",
    names: ["nginx.conf"],
    load: () => legacy(import("@codemirror/legacy-modes/mode/nginx"), "nginx"),
  },
  { id: "protobuf", name: "Protocol Buffers", ext: ["proto"], load: () => legacy(import("@codemirror/legacy-modes/mode/protobuf"), "protobuf") },
  {
    id: "log",
    name: "Journal (log)",
    ext: ["log", "out", "err"],
    names: ["syslog", "messages", "dmesg", "auth.log", "kern.log", "Xorg.0.log"],
    load: async () => {
      const [{ StreamLanguage }, { logfile }] = await Promise.all([import("@codemirror/language"), import("./logmode")]);
      return StreamLanguage.define(logfile);
    },
  },
];

const BY_ID = new Map(LANGUAGES.map((l) => [l.id, l]));

export function language(id: string): LangDef {
  return BY_ID.get(id) ?? LANGUAGES[0];
}

/** Suffixes de copies ou de modèles retirés avant la détection. */
const BACKUP = [/~$/, /\.(bak|old|orig|save|swp|tmp|dist|sample|example|default|in|template|dpkg-dist|dpkg-old|dpkg-new|rpmnew|rpmsave|ucf-dist)$/i];

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function byName(name: string): string | null {
  const lower = name.toLowerCase();
  for (const l of LANGUAGES) {
    if (l.names?.includes(name)) return l.id;
  }
  for (const l of LANGUAGES) {
    if (l.names?.some((n) => n.toLowerCase() === lower)) return l.id;
    if (l.prefixes?.some((p) => name.startsWith(p))) return l.id;
  }
  const dot = name.lastIndexOf(".");
  if (dot >= 0 && dot < name.length - 1) {
    const ext = lower.slice(dot + 1);
    // `.ts` : TypeScript, sauf fichiers de traduction Qt (XML), reconnus à leur contenu.
    if (ext === "ts") return "typescript";
    for (const l of LANGUAGES) if (l.ext?.includes(ext)) return l.id;
  }
  return null;
}

/** Langage d'après la première ligne (#!, <?xml, <!DOCTYPE…). */
export function languageFromFirstLine(line: string): string | null {
  const l = line.replace(/^﻿/, "").trimStart();
  const shebang = /^#!\s*(\S+)(?:\s+(?:-\S+\s+)*(\S+))?/.exec(l);
  if (shebang) {
    let prog = baseName(shebang[1]);
    if (prog === "env" && shebang[2]) prog = baseName(shebang[2]);
    prog = prog.replace(/[\d.]+$/, "") || prog;
    for (const def of LANGUAGES) if (def.interpreters?.some((i) => i.replace(/[\d.]+$/, "") === prog)) return def.id;
    return null;
  }
  if (/^<\?xml\b/i.test(l)) return "xml";
  if (/^<!doctype\s+html|^<html[\s>]/i.test(l)) return "html";
  if (/^<\?php\b/i.test(l)) return "php";
  if (/^(diff --git |--- \S|Index: \S)/.test(l)) return "diff";
  if (/^-\*- mode: ?makefile/i.test(l)) return "makefile";
  return null;
}

/**
 * Langage d'un fichier : nom du fichier (extension, noms connus), puis sa
 * première ligne. Sans indice : texte brut.
 */
export function detectLanguage(path: string | null, firstLine = ""): string {
  if (path) {
    let name = baseName(path);
    const direct = byName(name);
    // Traductions Qt (.ts) : XML.
    if (direct === "typescript" && /\.ts$/i.test(name) && /^<\?xml|^<!DOCTYPE TS/i.test(firstLine.trimStart())) return "xml";
    if (direct) {
      // `.conf` sous un dossier nginx : Nginx.
      if (direct === "ini" && /[\\/]nginx[\\/]/.test(path) && /\.conf$/i.test(name)) return "nginx";
      return direct;
    }
    // Copies et modèles : fichier.conf.bak, Makefile.in, config.h.in…
    for (let i = 0; i < 3; i++) {
      const stripped = BACKUP.reduce((n, re) => n.replace(re, ""), name);
      if (stripped === name || !stripped) break;
      name = stripped;
      const id = byName(name);
      if (id) return id;
    }
  }
  return languageFromFirstLine(firstLine) ?? "plain";
}

/** Extension proposée à l'enregistrement d'un document sans titre. */
export function defaultExtension(id: string): string {
  const def = language(id);
  if (id === "typescript") return "ts";
  if (def.ext?.length) return def.ext[0];
  return "txt";
}
