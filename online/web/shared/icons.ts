// Icônes des fichiers (celles de l'application de bureau, et deux icônes simples).

import { appFor } from "./apps";

const FOLDER =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2h8.4A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" fill="#f2b713"/><path d="M3 9h18v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" fill="#f6c84a"/></svg>';
const FILE =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 3h8l4 4v14H6z" fill="#fff" stroke="#9a9ca0"/><path d="M14 3v4h4" fill="none" stroke="#9a9ca0"/><path d="M8.5 11h7M8.5 14h7M8.5 17h5" stroke="#9a9ca0"/></svg>';

const MIME: Record<string, string> = {
  writer: "/icons/mime-document.svg",
  sheet: "/icons/mime-spreadsheet.svg",
  present: "/icons/mime-presentation.svg",
  draw: "/icons/mime-drawing.svg",
  pdf: "/icons/mime-pdf.svg",
};

/** Élément d'icône d'un fichier ou d'un dossier. */
export function fileIcon(name: string, dir: boolean): HTMLElement {
  const span = document.createElement("span");
  span.className = "ico";
  const src = dir ? null : MIME[appFor(name)];
  if (src) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    img.width = 20;
    img.height = 20;
    span.append(img);
  } else span.innerHTML = dir ? FOLDER : FILE;
  return span;
}
