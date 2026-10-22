// Barre de menus native de la fenêtre (Tauri), construite depuis actions.ts.
// Linux et Windows : un menu par fenêtre ; macOS : menu de l'application,
// réinstallé par la fenêtre qui prend le focus.

import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MenuDef, MenuEntry } from "./actions";
import { fileName } from "./util";

const IS_MAC = navigator.platform.toLowerCase().includes("mac");

type NativeItem = MenuItem | CheckMenuItem | PredefinedMenuItem | Submenu;

export class NativeMenu {
  private checks = new Map<string, CheckMenuItem>();
  private checked = new Map<string, boolean>();
  private recent: Submenu | null = null;
  private menu: Menu | null = null;

  constructor(private run: (id: string) => void) {}

  private async entry(e: MenuEntry): Promise<NativeItem | null> {
    if (e === "-") return PredefinedMenuItem.new({ item: "Separator" });
    if ("predefined" in e) {
      const text = { Cut: "Couper", Copy: "Copier", Paste: "Coller" }[e.predefined];
      return PredefinedMenuItem.new({ item: e.predefined, text });
    }
    if ("dynamic" in e) return null;
    if ("submenu" in e) {
      const items = (await Promise.all(e.items.map((i) => this.entry(i)))).filter((i): i is NativeItem => !!i);
      const sub = await Submenu.new({ text: e.submenu, items });
      if (e.items.some((i) => i !== "-" && "dynamic" in i)) this.recent = sub;
      return sub;
    }
    const opts = { id: e.id, text: e.label, accelerator: e.accel, action: () => this.run(e.id) };
    if (e.check) {
      const item = await CheckMenuItem.new({ ...opts, checked: false });
      this.checks.set(e.id, item);
      this.checked.set(e.id, false);
      return item;
    }
    return MenuItem.new(opts);
  }

  async install(defs: MenuDef[]) {
    const subs: Submenu[] = [];
    if (IS_MAC) {
      subs.push(
        await Submenu.new({
          text: "AuxiText",
          items: [
            await MenuItem.new({ text: "À propos d'AuxiText", action: () => this.run("about") }),
            await PredefinedMenuItem.new({ item: "Separator" }),
            await MenuItem.new({ text: "Préférences…", accelerator: "Cmd+,", action: () => this.run("preferences") }),
            await PredefinedMenuItem.new({ item: "Separator" }),
            await PredefinedMenuItem.new({ item: "Hide", text: "Masquer AuxiText" }),
            await PredefinedMenuItem.new({ item: "HideOthers", text: "Masquer les autres" }),
            await PredefinedMenuItem.new({ item: "Separator" }),
            await MenuItem.new({ text: "Quitter AuxiText", accelerator: "Cmd+Q", action: () => this.run("quit") }),
          ],
        }),
      );
    }
    for (const def of defs) {
      const items = (await Promise.all(def.items.map((i) => this.entry(i)))).filter((i): i is NativeItem => !!i);
      subs.push(await Submenu.new({ text: def.label, items }));
    }
    this.menu = await Menu.new({ items: subs });
    await this.activate();
  }

  /** Installe ce menu (macOS : à chaque prise de focus de la fenêtre). */
  async activate() {
    if (!this.menu) return;
    if (IS_MAC) await this.menu.setAsAppMenu();
    else await this.menu.setAsWindowMenu(getCurrentWindow());
  }

  /** Coches : seules celles qui changent sont envoyées à la coque. */
  setChecked(states: Record<string, boolean>) {
    for (const [id, on] of Object.entries(states)) {
      const item = this.checks.get(id);
      if (!item || this.checked.get(id) === on) continue;
      this.checked.set(id, on);
      void item.setChecked(on);
    }
  }

  /**
   * Un clic sur une case à cocher l'inverse côté GTK : l'état connu n'est
   * plus sûr, il sera renvoyé à la prochaine mise à jour.
   */
  invalidate(id: string) {
    if (this.checked.has(id)) this.checked.delete(id);
  }

  /** Sous-menu « Ouvrir un fichier récent ». */
  async setRecent(list: string[]) {
    const sub = this.recent;
    if (!sub) return;
    for (const it of await sub.items()) await sub.remove(it);
    if (!list.length) {
      await sub.append(await MenuItem.new({ text: "(aucun)", enabled: false }));
      return;
    }
    const items: NativeItem[] = [];
    for (const [i, p] of list.entries()) {
      const label = `${i < 9 ? `${i + 1}. ` : ""}${fileName(p)} — ${p}`;
      items.push(await MenuItem.new({ text: label.replace(/&/g, "&&"), action: () => this.run(`recent:${p}`) }));
    }
    items.push(await PredefinedMenuItem.new({ item: "Separator" }));
    items.push(await MenuItem.new({ text: "Effacer la liste", action: () => this.run("clearRecent") }));
    await sub.append(items);
  }
}
