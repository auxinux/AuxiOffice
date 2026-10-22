// Boîtes de dialogue dans la page (questions, préférences, à propos) et
// menus surgissants de la barre d'état.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_PREFS, FONT_SIZES, INDENT_WIDTHS, type Prefs } from "./prefs";

export interface Button {
  label: string;
  value: string;
  kind?: "primary" | "danger";
}

export interface ModalSpec {
  title: string;
  body: ReactNode;
  buttons: Button[];
  /** Valeur rendue par Échap ou un clic hors de la boîte. */
  cancel?: string;
  wide?: boolean;
}

export function Modal({ spec, onClose }: { spec: ModalSpec; onClose: (value: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Focus : premier champ, sinon bouton principal.
    const el = box.current;
    const field = el?.querySelector<HTMLElement>("input, select, textarea");
    const primary = el?.querySelector<HTMLElement>("button.primary") ?? el?.querySelector<HTMLElement>(".buttons button");
    (field ?? primary)?.focus();
  }, [spec]);
  const cancel = spec.cancel ?? spec.buttons[spec.buttons.length - 1]?.value ?? "cancel";
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose(cancel);
      }}
    >
      <div
        ref={box}
        className={`modal ${spec.wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={spec.title}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose(cancel);
          } else if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
            const primary = spec.buttons.find((b) => b.kind === "primary");
            if (primary) {
              e.preventDefault();
              onClose(primary.value);
            }
          } else if (e.key === "Tab") {
            // Le focus reste dans la boîte.
            const items = [...(box.current?.querySelectorAll<HTMLElement>("input, select, textarea, button, a[href]") ?? [])];
            if (!items.length) return;
            const i = items.indexOf(document.activeElement as HTMLElement);
            const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
            e.preventDefault();
            items[next].focus();
          }
        }}
      >
        <h2>{spec.title}</h2>
        <div className="modal-body">{spec.body}</div>
        <div className="buttons">
          {spec.buttons.map((b) => (
            <button key={b.value} className={b.kind ?? ""} onClick={() => onClose(b.value)}>
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const FONTS = ["Hack", "Noto Sans Mono", "DejaVu Sans Mono", "Liberation Mono", "Fira Code", "JetBrains Mono", "Source Code Pro", "Ubuntu Mono", "Cascadia Code", "Monospace"];

export function PrefsForm({ prefs, onChange }: { prefs: Prefs; onChange: (p: Prefs) => void }) {
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => onChange({ ...prefs, [k]: v });
  return (
    <div className="prefs">
      <fieldset>
        <legend>Police</legend>
        <label>
          Famille
          <input list="auxitext-fonts" value={prefs.fontFamily} placeholder="Police à chasse fixe du système" onChange={(e) => set("fontFamily", e.target.value)} />
          <datalist id="auxitext-fonts">
            {FONTS.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </label>
        <label>
          Taille
          <input
            type="number"
            min={FONT_SIZES.min}
            max={FONT_SIZES.max}
            value={prefs.fontSize}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= FONT_SIZES.min && n <= FONT_SIZES.max) set("fontSize", Math.round(n));
            }}
          />
        </label>
        <p className="hint">Zoom actuel : {Math.round(prefs.zoom * 100)} % (Ctrl+molette, Ctrl+0 pour revenir à 100 %).</p>
      </fieldset>
      <fieldset>
        <legend>Indentation</legend>
        <label className="row">
          <input type="radio" name="indent" checked={!prefs.indentWithTabs} onChange={() => set("indentWithTabs", false)} /> Espaces
        </label>
        <label className="row">
          <input type="radio" name="indent" checked={prefs.indentWithTabs} onChange={() => set("indentWithTabs", true)} /> Tabulations
        </label>
        <label>
          Largeur
          <select value={prefs.indentWidth} onChange={(e) => set("indentWidth", Number(e.target.value))}>
            {[...new Set([...INDENT_WIDTHS, prefs.indentWidth])].sort((a, b) => a - b).map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <label className="row">
          <input type="checkbox" checked={prefs.detectIndent} onChange={(e) => set("detectIndent", e.target.checked)} /> Déduire l'indentation du contenu des fichiers
        </label>
      </fieldset>
      <fieldset>
        <legend>Affichage</legend>
        <label className="row">
          <input type="checkbox" checked={prefs.wrap} onChange={(e) => set("wrap", e.target.checked)} /> Retour à la ligne automatique
        </label>
        <label className="row">
          <input type="checkbox" checked={prefs.lineNumbers} onChange={(e) => set("lineNumbers", e.target.checked)} /> Numéros de ligne
        </label>
        <label className="row">
          <input type="checkbox" checked={prefs.highlightLine} onChange={(e) => set("highlightLine", e.target.checked)} /> Mettre en évidence la ligne courante
        </label>
        <label className="row">
          <input type="checkbox" checked={prefs.showWhitespace} onChange={(e) => set("showWhitespace", e.target.checked)} /> Afficher les espaces et tabulations
        </label>
        <label>
          Thème
          <select value={prefs.theme} onChange={(e) => set("theme", e.target.value as Prefs["theme"])}>
            <option value="system">Suivre le système</option>
            <option value="light">Clair</option>
            <option value="dark">Sombre</option>
          </select>
        </label>
      </fieldset>
      <button className="link" onClick={() => onChange({ ...DEFAULT_PREFS })}>
        Rétablir les réglages par défaut
      </button>
    </div>
  );
}

export interface PopupItem {
  id: string;
  label: string;
  checked?: boolean;
  header?: boolean;
}

/** Menu surgissant au-dessus de la barre d'état, avec filtre facultatif. */
export function Popup({ items, x, filter, onPick, onClose }: { items: PopupItem[]; x: number; filter?: boolean; onPick: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? items.filter((i) => !i.header && i.label.toLowerCase().includes(n)) : items;
  }, [items, q]);
  const pickable = shown.filter((i) => !i.header);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", down, true);
    return () => window.removeEventListener("mousedown", down, true);
  }, [onClose]);
  useEffect(() => {
    if (filter) ref.current?.querySelector("input")?.focus();
    else ref.current?.focus();
    const i = pickable.findIndex((p) => p.checked);
    ref.current?.querySelectorAll(".item")[Math.max(0, i)]?.scrollIntoView({ block: "nearest" });
  }, []);
  return (
    <div
      ref={ref}
      className="popup"
      style={{ left: Math.max(4, Math.min(x, window.innerWidth - 300)) }}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const d = e.key === "ArrowDown" ? 1 : -1;
          setSel((s) => (s + d + pickable.length) % Math.max(1, pickable.length));
        } else if (e.key === "Enter") {
          const p = pickable[sel] ?? (pickable.length === 1 ? pickable[0] : undefined);
          if (p) onPick(p.id);
        }
      }}
    >
      {filter && <input className="popup-filter" value={q} placeholder="Filtrer…" onChange={(e) => (setQ(e.target.value), setSel(0))} />}
      <div className="popup-list" role="menu">
        {shown.map((i) =>
          i.header ? (
            <div key={i.id} className="header">
              {i.label}
            </div>
          ) : (
            <div
              key={i.id}
              role="menuitemradio"
              aria-checked={!!i.checked}
              className={`item ${i.checked ? "checked" : ""} ${pickable[sel] === i ? "sel" : ""}`}
              onClick={() => onPick(i.id)}
            >
              <span className="check">{i.checked ? "✓" : ""}</span>
              {i.label}
            </div>
          ),
        )}
        {!shown.length && <div className="header">Aucun résultat</div>}
      </div>
    </div>
  );
}
