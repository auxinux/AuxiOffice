// Barre de menus native (Linux et Windows : par fenêtre ; macOS : de l'application).
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";

const IS_MAC = navigator.platform.toLowerCase().includes("mac");

type Entry = "-" | { predefined: "Cut" | "Copy" | "Paste" | "SelectAll"; text: string } | [id: string, label: string, accel?: string];

export const MENUS: [string, Entry[]][] = [
  ["Fichier", [
    ["new", "Nouveau…", "CmdOrCtrl+N"],
    ["fromImages", "Créer à partir d'images…"],
    ["open", "Ouvrir…", "CmdOrCtrl+O"],
    "-",
    ["save", "Enregistrer", "CmdOrCtrl+S"],
    ["saveAs", "Enregistrer sous…", "CmdOrCtrl+Shift+S"],
    "-",
    ["merge", "Fusionner des PDF…", "CmdOrCtrl+Shift+M"],
    ["split", "Découper le document…"],
    "-",
    ["password", "Mot de passe…"],
    ["metadata", "Propriétés…"],
    "-",
    ["print", "Imprimer…", "CmdOrCtrl+P"],
    "-",
    ["close", "Fermer", "CmdOrCtrl+W"],
  ]],
  ["Édition", [
    ["undo", "Annuler", "CmdOrCtrl+Z"],
    ["redo", "Rétablir", IS_MAC ? "Cmd+Shift+Z" : "CmdOrCtrl+Y"],
    "-",
    // Sans ces entrées, macOS ne transmet ni Cmd+C ni Cmd+V aux champs de saisie.
    { predefined: "Cut", text: "Couper" },
    { predefined: "Copy", text: "Copier" },
    { predefined: "Paste", text: "Coller" },
    { predefined: "SelectAll", text: "Tout sélectionner" },
    "-",
    ["copyObject", "Copier l'objet", undefined],
    ["pasteObject", "Coller l'objet", undefined],
    ["deleteObject", "Supprimer l'objet"],
    "-",
    ["find", "Rechercher…", "CmdOrCtrl+F"],
  ]],
  ["Insertion", [
    ["tool:editText", "Modifier le texte du document", "CmdOrCtrl+E"],
    "-",
    ["tool:text", "Zone de texte", "CmdOrCtrl+T"],
    ["image", "Image…"],
    ["tool:rect", "Rectangle"],
    ["tool:ellipse", "Ellipse"],
    ["tool:line", "Ligne"],
    ["tool:highlight", "Surlignage"],
    ["tool:whiteout", "Masque blanc"],
  ]],
  ["Pages", [
    ["pageBlank", "Insérer une page vierge"],
    ["pageFile", "Insérer depuis un PDF…"],
    ["pageDuplicate", "Dupliquer"],
    ["pageDelete", "Supprimer"],
    "-",
    ["rotateLeft", "Tourner à gauche"],
    ["rotateRight", "Tourner à droite"],
    ["crop", "Recadrer…"],
    "-",
    ["extract", "Extraire dans un nouveau PDF…"],
    "-",
    ["numbers", "Numéroter les pages…"],
    ["watermark", "Filigrane…"],
  ]],
  ["Affichage", [
    ["sidebar", "Panneau des pages", "F4"],
    "-",
    ["zoomIn", "Zoom avant", "CmdOrCtrl+="],
    ["zoomOut", "Zoom arrière", "CmdOrCtrl+-"],
    ["zoomFit", "Page entière"],
    ["zoomWidth", "Pleine largeur"],
    ["zoomActual", "Taille réelle", "CmdOrCtrl+0"],
  ]],
  ["Aide", [["about", "À propos d'AuxiPDFWriter"]]],
];

// Windows : WebView2 garde le clavier pour lui et a ses propres raccourcis
// (F5 recharge la page et perdrait le document ; Ctrl+P, Ctrl+F…). La page les
// bloque et lance elle-même les commandes du menu.
export const IS_WINDOWS = navigator.platform.toLowerCase().startsWith("win");

/** Nom d'une touche : « ctrl+shift+s », « f4 ». */
export function keyName(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): string {
  const key = e.key === "+" ? "=" : e.key.toLowerCase();
  return `${e.ctrlKey || e.metaKey ? "ctrl+" : ""}${e.shiftKey ? "shift+" : ""}${e.altKey ? "alt+" : ""}${key}`;
}

export function shortcuts(menus = MENUS): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, items] of menus) {
    for (const e of items) {
      if (Array.isArray(e) && e[2]) out.set(e[2].toLowerCase().replace("cmdorctrl", "ctrl"), e[0]);
    }
  }
  return out;
}

export const BROWSER_KEYS = new Set(["f3", "f5", "f7", "f12", "ctrl+r", "ctrl+f5", "ctrl+shift+r", "ctrl+p", "ctrl+f", "ctrl+g", "ctrl+shift+g", "ctrl+u", "ctrl+j", "ctrl+h", "ctrl+d", "ctrl+shift+i", "ctrl+shift+j", "alt+arrowleft", "alt+arrowright"]);

let menu: Menu | null = null;

export async function installMenu(run: (id: string) => void) {
  const build = async (e: Entry) => {
    if (e === "-") return PredefinedMenuItem.new({ item: "Separator" });
    if ("predefined" in e) return PredefinedMenuItem.new({ item: e.predefined, text: e.text });
    return MenuItem.new({ id: e[0], text: e[1], accelerator: e[2], action: () => run(e[0]) });
  };
  const subs = await Promise.all(MENUS.map(async ([text, items]) => Submenu.new({ text, items: await Promise.all(items.map(build)) })));
  if (IS_MAC) {
    // macOS : le premier menu est celui de l'application.
    subs.unshift(
      await Submenu.new({
        text: "AuxiPDFWriter",
        items: [
          await MenuItem.new({ text: "À propos d'AuxiPDFWriter", action: () => run("about") }),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await PredefinedMenuItem.new({ item: "Hide", text: "Masquer AuxiPDFWriter" }),
          await PredefinedMenuItem.new({ item: "HideOthers", text: "Masquer les autres" }),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await PredefinedMenuItem.new({ item: "Quit", text: "Quitter AuxiPDFWriter" }),
        ],
      }),
    );
  }
  menu = await Menu.new({ items: subs });
  await activateMenu();
}

/** macOS : un seul menu pour l'application ; la fenêtre qui prend le focus installe le sien. */
export async function activateMenu() {
  if (!menu) return;
  if (IS_MAC) await menu.setAsAppMenu();
  else await menu.setAsWindowMenu(getCurrentWindow());
}
