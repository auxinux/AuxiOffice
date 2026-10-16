// Menu contextuel (clic droit) : LibreOffice envoie sa structure complète
// (rappel « context_menu ») ; AuxiOffice l'affiche et exécute la commande
// choisie.

import { useEffect, useRef, useState } from "react";

export interface LoMenuItem {
  type: "command" | "separator" | "menu";
  text?: string;
  command?: string;
  enabled?: string;
  checktype?: string;
  checked?: string;
  menu?: LoMenuItem[];
}

/** Libellé LibreOffice : « ~ » marque la lettre d'accès clavier. */
export function menuLabel(text = ""): string {
  return text.replace(/~/g, "");
}

/** Retire les entrées inactives (comme LibreOffice sur le bureau), les
 * sous-menus vides et les séparateurs en double, en tête et en fin. */
export function cleanMenu(items: LoMenuItem[]): LoMenuItem[] {
  const out: LoMenuItem[] = [];
  for (const it of items) {
    if (it.type === "command" && it.enabled === "false") continue;
    if (it.type === "menu" && !cleanMenu(it.menu ?? []).length) continue;
    if (it.type === "separator" && (out.length === 0 || out[out.length - 1].type === "separator")) continue;
    if (it.type === "menu" && !(it.menu && it.menu.length)) continue;
    out.push(it);
  }
  while (out.length && out[out.length - 1].type === "separator") out.pop();
  return out;
}

interface Props {
  x: number;
  y: number;
  items: LoMenuItem[];
  onCommand: (command: string) => void;
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onCommand, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    const close = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", esc, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", esc, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // Rester dans la fenêtre.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 4), y: Math.min(y, window.innerHeight - r.height - 4) });
  }, [x, y]);

  return (
    <div ref={ref} className="ctx-menu" style={{ left: pos.x, top: pos.y }} role="menu">
      <MenuList items={items} onCommand={onCommand} />
    </div>
  );
}

function MenuList({ items, onCommand }: { items: LoMenuItem[]; onCommand: (c: string) => void }) {
  return (
    <>
      {cleanMenu(items).map((it, i) => {
        if (it.type === "separator") return <div key={i} className="ctx-sep" />;
        const disabled = it.enabled === "false";
        if (it.type === "menu") {
          return (
            <div key={i} className={`ctx-item sub ${disabled ? "disabled" : ""}`} role="menuitem" aria-haspopup="true">
              <span className="check" />
              <span className="label">{menuLabel(it.text)}</span>
              <span className="arrow">›</span>
              <div className="ctx-menu ctx-submenu">
                <MenuList items={it.menu ?? []} onCommand={onCommand} />
              </div>
            </div>
          );
        }
        return (
          <button key={i} className="ctx-item" role="menuitem" disabled={disabled} onClick={() => it.command && onCommand(it.command)}>
            <span className="check">{it.checked === "true" ? (it.checktype === "radio" ? "●" : "✓") : ""}</span>
            <span className="label">{menuLabel(it.text)}</span>
          </button>
        );
      })}
    </>
  );
}
