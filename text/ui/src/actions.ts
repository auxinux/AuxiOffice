// Commandes d'AuxiText et barre de menus (description sans interface :
// menus.ts la construit avec l'API native de Tauri).

import { LANGUAGES } from "./languages";
import { ENCODINGS, EOLS } from "./encodings";
import { INDENT_WIDTHS } from "./prefs";

export type MenuEntry =
  | "-"
  | { id: string; label: string; accel?: string; check?: boolean }
  | { submenu: string; items: MenuEntry[] }
  | { dynamic: "recent" }
  | { predefined: "Cut" | "Copy" | "Paste" };

export interface MenuDef {
  label: string;
  items: MenuEntry[];
}

export function menuBar(opts: { writer: boolean; auxicorrect?: boolean }): MenuDef[] {
  return [
    {
      label: "&Fichier",
      items: [
        { id: "new", label: "Nouveau", accel: "CmdOrCtrl+N" },
        { id: "newWindow", label: "Nouvelle fenêtre", accel: "CmdOrCtrl+Shift+N" },
        "-",
        { id: "open", label: "Ouvrir…", accel: "CmdOrCtrl+O" },
        { submenu: "Ouvrir un fichier récent", items: [{ dynamic: "recent" }] },
        "-",
        { id: "save", label: "Enregistrer", accel: "CmdOrCtrl+S" },
        { id: "saveAs", label: "Enregistrer sous…", accel: "CmdOrCtrl+Shift+S" },
        { id: "saveAll", label: "Enregistrer tout", accel: "CmdOrCtrl+Alt+S" },
        { id: "reload", label: "Recharger", accel: "CmdOrCtrl+R" },
        "-",
        ...(opts.writer ? [{ id: "openInWriter", label: "Ouvrir dans AuxiWriter" }, "-" as const] : []),
        { id: "print", label: "Imprimer…", accel: "CmdOrCtrl+P" },
        "-",
        { id: "closeTab", label: "Fermer l'onglet", accel: "CmdOrCtrl+W" },
        { id: "closeWindow", label: "Fermer la fenêtre", accel: "CmdOrCtrl+Shift+W" },
        { id: "quit", label: "Quitter", accel: "CmdOrCtrl+Q" },
      ],
    },
    {
      label: "&Édition",
      items: [
        { id: "undo", label: "Annuler", accel: "CmdOrCtrl+Z" },
        { id: "redo", label: "Rétablir", accel: "CmdOrCtrl+Y" },
        "-",
        { predefined: "Cut" },
        { predefined: "Copy" },
        { predefined: "Paste" },
        { id: "selectAll", label: "Tout sélectionner", accel: "CmdOrCtrl+A" },
        "-",
        { id: "duplicateLine", label: "Dupliquer la ligne", accel: "CmdOrCtrl+Shift+D" },
        { id: "deleteLine", label: "Supprimer la ligne", accel: "CmdOrCtrl+Shift+K" },
        { id: "moveLineUp", label: "Monter la ligne", accel: "Alt+Up" },
        { id: "moveLineDown", label: "Descendre la ligne", accel: "Alt+Down" },
        { id: "toggleComment", label: "Commenter ou décommenter", accel: "CmdOrCtrl+/" },
        "-",
        {
          submenu: "Transformer",
          items: [
            { id: "upper", label: "MAJUSCULES" },
            { id: "lower", label: "minuscules" },
            "-",
            { id: "sortAsc", label: "Trier les lignes (A → Z)" },
            { id: "sortDesc", label: "Trier les lignes (Z → A)" },
            "-",
            { id: "trimTrailing", label: "Retirer les espaces en fin de ligne" },
            { id: "tabsToSpaces", label: "Tabulations → espaces" },
            { id: "spacesToTabs", label: "Espaces → tabulations" },
          ],
        },
      ],
    },
    {
      label: "&Rechercher",
      items: [
        { id: "find", label: "Rechercher…", accel: "CmdOrCtrl+F" },
        { id: "replace", label: "Remplacer…", accel: "CmdOrCtrl+H" },
        { id: "findNext", label: "Occurrence suivante", accel: "F3" },
        { id: "findPrev", label: "Occurrence précédente", accel: "Shift+F3" },
        { id: "selectAllMatches", label: "Sélectionner toutes les occurrences", accel: "CmdOrCtrl+Shift+L" },
        "-",
        { id: "gotoLine", label: "Aller à la ligne…", accel: "CmdOrCtrl+G" },
      ],
    },
    {
      label: "&Affichage",
      items: [
        { id: "wrap", label: "Retour à la ligne automatique", accel: "Alt+Z", check: true },
        { id: "lineNumbers", label: "Numéros de ligne", check: true },
        { id: "highlightLine", label: "Mettre en évidence la ligne courante", check: true },
        { id: "showWhitespace", label: "Afficher les espaces et tabulations", check: true },
        "-",
        {
          submenu: "Thème",
          items: [
            { id: "theme.system", label: "Suivre le système", check: true },
            { id: "theme.light", label: "Clair", check: true },
            { id: "theme.dark", label: "Sombre", check: true },
          ],
        },
        "-",
        { id: "zoomIn", label: "Zoom avant", accel: "CmdOrCtrl+=" },
        { id: "zoomOut", label: "Zoom arrière", accel: "CmdOrCtrl+-" },
        { id: "zoomReset", label: "Taille normale", accel: "CmdOrCtrl+0" },
      ],
    },
    {
      label: "&Outils",
      items: [
        { submenu: "Langage", items: LANGUAGES.map((l) => ({ id: `lang.${l.id}`, label: l.name, check: true })) },
        "-",
        { submenu: "Encodage à l'enregistrement", items: ENCODINGS.map((e, i) => ({ id: `enc.${i}`, label: e.label, check: true })) },
        { submenu: "Rouvrir avec l'encodage", items: ENCODINGS.filter((e) => !e.bom || e.encoding !== "UTF-8").map((e) => ({ id: `reopen.${ENCODINGS.indexOf(e)}`, label: e.label })) },
        { submenu: "Fins de ligne", items: EOLS.map((e) => ({ id: `eol.${e.id}`, label: e.label, check: true })) },
        {
          submenu: "Indentation",
          items: [
            { id: "indent.spaces", label: "Espaces", check: true },
            { id: "indent.tabs", label: "Tabulations", check: true },
            "-",
            ...INDENT_WIDTHS.map((w) => ({ id: `indent.w.${w}`, label: `Largeur : ${w}`, check: true })),
          ],
        },
        "-",
        ...(opts.auxicorrect
          ? [
              {
                submenu: "AuxiCorrect",
                items: [
                  { id: "spelling", label: "Corriger le français", accel: "F7", check: true },
                  { id: "spellInternational", label: "Français international (sinon québécois)", check: true },
                  "-" as const,
                  { id: "auxicorrectApp", label: "Ouvrir AuxiCorrect…" },
                ],
              },
              "-" as const,
            ]
          : []),
        { id: "stats", label: "Statistiques du document…" },
        { id: "preferences", label: "Préférences…", accel: "CmdOrCtrl+," },
      ],
    },
    {
      label: "Ai&de",
      items: [
        { id: "about", label: "À propos d'AuxiText" },
        { id: "licenses", label: "Licences" },
      ],
    },
  ];
}

/** Tous les éléments simples (avec un identifiant), sous-menus compris. */
export function flatItems(defs: MenuDef[]): { id: string; label: string; accel?: string; check?: boolean }[] {
  const out: { id: string; label: string; accel?: string; check?: boolean }[] = [];
  const walk = (items: MenuEntry[]) => {
    for (const e of items) {
      if (e === "-" || "dynamic" in e || "predefined" in e) continue;
      if ("submenu" in e) walk(e.items);
      else out.push(e);
    }
  };
  defs.forEach((d) => walk(d.items));
  return out;
}

/**
 * Raccourci de menu (« CmdOrCtrl+Shift+S ») au format de CodeMirror
 * (« Mod-Shift-s ») : la page les reçoit aussi quand la barre de menus native
 * ne les intercepte pas.
 */
export function accelToKey(accel: string): string {
  return accel
    .split("+")
    .map((p) => {
      if (p === "CmdOrCtrl") return "Mod";
      if (p === "Up") return "ArrowUp";
      if (p === "Down") return "ArrowDown";
      return p.length === 1 ? p.toLowerCase() : p;
    })
    .join("-");
}
