// Applications d'AuxiOffice Online et type de fichier → application
// (même répartition que `AppKind::for_path` de l'application de bureau).

export type OfficeKind = "office" | "writer" | "sheet" | "present" | "draw" | "pdf";
export type AppId = OfficeKind | "text" | "sheetlite";

export const APPS: { id: AppId; name: string; icon: string; blurb: string }[] = [
  { id: "office", name: "AuxiOffice", icon: "/icons/auxioffice.svg", blurb: "Tous vos documents, en onglets" },
  { id: "writer", name: "AuxiWriter", icon: "/icons/auxiwriter.svg", blurb: "Traitement de texte" },
  { id: "sheet", name: "AuxiSheet", icon: "/icons/auxisheet.svg", blurb: "Tableur" },
  { id: "present", name: "AuxiPresent", icon: "/icons/auxipresent.svg", blurb: "Présentations" },
  { id: "draw", name: "AuxiDraw", icon: "/icons/auxidraw.svg", blurb: "Dessin et diagrammes" },
  { id: "pdf", name: "AuxiPDF", icon: "/icons/auxipdf.svg", blurb: "Lecture et annotation de PDF" },
  { id: "sheetlite", name: "AuxiSheet Lite", icon: "/icons/auxisheet.svg", blurb: "Tableur léger, calculé dans votre navigateur" },
  { id: "text", name: "AuxiText", icon: "/auxitext.svg", blurb: "Éditeur de texte et de code" },
];

/** Classeurs que AuxiSheet Lite sait ouvrir. */
export const isLiteSheet = (path: string) => extension(path) === "xlsx";

export const appName = (id: AppId) => APPS.find((a) => a.id === id)?.name ?? "AuxiOffice";

const SHEET = ["xlsx", "xlsm", "xltx", "xltm", "xls", "xlt", "xlsb", "ods", "ots", "csv", "fods"];
const PRESENT = ["pptx", "pptm", "ppsx", "potx", "potm", "ppt", "pps", "pot", "odp", "otp", "fodp"];
const DRAW = ["odg", "otg", "fodg", "vsdx", "vsd", "vsdm", "vdx", "vstx", "vst", "cdr", "cmx", "pub", "wpg", "svg"];
const WRITER = ["docx", "docm", "dotx", "dotm", "doc", "dot", "odt", "ott", "fodt", "rtf", "wpd", "pages", "abw", "lwp", "hwp", "epub"];

/** Fichiers ouverts par AuxiText depuis le portail (texte brut, code, configuration). */
const TEXT = [
  "txt", "text", "md", "markdown", "log", "ini", "cfg", "conf", "toml", "yaml", "yml", "json", "jsonc", "xml", "html", "htm", "css", "scss", "js", "mjs", "cjs",
  "ts", "tsx", "jsx", "py", "rs", "go", "java", "kt", "c", "h", "cpp", "hpp", "cc", "cs", "php", "rb", "pl", "lua", "sh", "bash", "zsh", "ps1", "bat", "sql",
  "env", "properties", "gitignore", "dockerfile", "makefile", "mk", "cmake", "tex", "srt", "vtt", "diff", "patch", "service", "desktop",
];

export function extension(path: string): string {
  const name = (path.split("/").pop() ?? "").toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : name;
}

/** Application de bureautique d'un fichier (AuxiWriter par défaut). */
export function officeKindFor(path: string): Exclude<OfficeKind, "office"> {
  const e = extension(path);
  if (SHEET.includes(e)) return "sheet";
  if (PRESENT.includes(e)) return "present";
  if (DRAW.includes(e)) return "draw";
  if (e === "pdf") return "pdf";
  return "writer";
}

/** Application qui ouvre un fichier depuis le portail. */
export function appFor(path: string): AppId {
  const e = extension(path);
  if (WRITER.includes(e)) return "writer";
  if (TEXT.includes(e) || !e.length) return "text";
  return officeKindFor(path);
}

/** Adresse d'une application, avec des fichiers à ouvrir ou un document vierge. */
export function appUrl(id: AppId, files: string[] = [], newDoc = false): string {
  const p = new URLSearchParams();
  if (id !== "text" && id !== "sheetlite") p.set("app", id);
  for (const f of files) p.append("open", f);
  if (newDoc) p.set("new", "1");
  const qs = p.toString();
  const dir = id === "text" ? "/text/" : id === "sheetlite" ? "/sheet/" : "/office/";
  return `${dir}${qs ? `?${qs}` : ""}`;
}

/** Ouvre une application dans un nouvel onglet du navigateur. */
export function launch(id: AppId, files: string[] = [], newDoc = false) {
  window.open(appUrl(id, files, newDoc), "_blank");
}
