// Barre de menus native (menu de l'application sous macOS, barre de menus
// de la fenêtre sous Linux et Windows), construite depuis actions.ts et
// reconstruite quand le type du document actif change.

import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { APP_NAMES, menusFor, type Action, type AppKind, type MenuEntry } from "./actions";
import type { DocType } from "./engine";

const IS_MAC = navigator.platform.toLowerCase().includes("mac");

let current: { key: string; checks: Map<string, CheckMenuItem[]> } | null = null;

type NativeItem = MenuItem | CheckMenuItem | PredefinedMenuItem | Submenu;

async function entry(e: MenuEntry, run: (a: Action) => void, checks: Map<string, CheckMenuItem[]>): Promise<NativeItem> {
  if (e === "-") return PredefinedMenuItem.new({ item: "Separator" });
  if ("submenu" in e) {
    const items: NativeItem[] = await Promise.all(e.items.map((i) => entry(i, run, checks)));
    return Submenu.new({ text: e.submenu, items });
  }
  const opts = { text: e.label, accelerator: e.accel, action: () => run(e) };
  if (e.check) {
    const item = await CheckMenuItem.new({ ...opts, checked: false });
    checks.set(e.check, [...(checks.get(e.check) ?? []), item]);
    return item;
  }
  return MenuItem.new(opts);
}

/** Installe la barre de menus pour le type de document actif (null = Accueil). */
export async function installMenus(type: DocType | null, run: (a: Action) => void, app: AppKind = "office") {
  const key = `${app}:${type ?? "home"}`;
  if (current?.key === key) return;
  const checks = new Map<string, CheckMenuItem[]>();
  const defs = menusFor(type, app);
  const name = APP_NAMES[app];
  const subs: Submenu[] = [];
  if (IS_MAC) {
    subs.push(
      await Submenu.new({
        text: name,
        items: [
          await MenuItem.new({ text: `À propos d'${name}`, action: () => run({ label: "À propos", app: "about" }) }),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await PredefinedMenuItem.new({ item: "Hide", text: `Masquer ${name}` }),
          await PredefinedMenuItem.new({ item: "HideOthers", text: "Masquer les autres" }),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await PredefinedMenuItem.new({ item: "Quit", text: `Quitter ${name}` }),
        ],
      }),
    );
  }
  for (const def of defs) {
    const items: NativeItem[] = await Promise.all(def.items.map((i) => entry(i, run, checks)));
    if (def.label === "Édition") {
      // Couper, copier, coller natifs : ils agissent sur la zone de saisie
      // active (document ou boîte de dialogue) via les événements du presse-papiers.
      items.splice(
        3,
        0,
        await PredefinedMenuItem.new({ item: "Cut", text: "Couper" }),
        await PredefinedMenuItem.new({ item: "Copy", text: "Copier" }),
        await PredefinedMenuItem.new({ item: "Paste", text: "Coller" }),
      );
    }
    subs.push(await Submenu.new({ text: def.label, items }));
  }
  if (!IS_MAC) {
    subs.push(await Submenu.new({ text: "Aide", items: [await MenuItem.new({ text: `À propos d'${name}`, action: () => run({ label: "À propos", app: "about" }) })] }));
  }
  const menu = await Menu.new({ items: subs });
  await menu.setAsAppMenu();
  current = { key, checks };
}

/** Coche les éléments selon l'état des commandes UNO du document actif. */
export function updateMenuChecks(states: Record<string, string>) {
  if (!current) return;
  for (const [cmd, items] of current.checks) {
    const on = states[cmd] === "true";
    for (const it of items) void it.setChecked(on);
  }
}
