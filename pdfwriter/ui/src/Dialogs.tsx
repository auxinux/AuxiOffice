// Boîtes de dialogue.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, fileName, type Printer } from "./api";
import { type Margins, type Metadata, type NumberingOptions, PAGE_FORMATS, parseRanges, type PageSpec, type Rgb, type WatermarkOptions } from "./core/pages";
import { Icon } from "./icons";

const PDF_FILTER = [{ name: "Documents PDF", extensions: ["pdf"] }];

export function Modal({ title, children, actions, onClose, width }: { title: string; children: ReactNode; actions: ReactNode; onClose: () => void; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input:not([type=hidden]), select, button.primary")?.focus();
  }, []);
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="modal" role="dialog" aria-label={title} style={width ? { width } : undefined} onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
        const box = ref.current!;
        if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.type !== "checkbox" && e.target.type !== "radio") {
          box.querySelector<HTMLButtonElement>("button.primary:not(:disabled)")?.click();
        }
        // La tabulation reste dans la boîte.
        if (e.key === "Tab") {
          const all = [...box.querySelectorAll<HTMLElement>("button:not(:disabled), input, select")];
          const i = all.indexOf(document.activeElement as HTMLElement);
          const next = all[(i + (e.shiftKey ? -1 : 1) + all.length) % all.length];
          e.preventDefault();
          next?.focus();
        }
      }}>
        <h2>{title}</h2>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  );
}

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="field"><span>{label}</span>{children}</label>
);

function FormatFields({ spec, set }: { spec: PageSpec; set: (s: PageSpec) => void }) {
  return (
    <>
      <Field label="Format">
        <select value={spec.format} onChange={(e) => set({ ...spec, format: e.target.value })}>
          {Object.entries(PAGE_FORMATS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
        </select>
      </Field>
      <Field label="Orientation">
        <select value={spec.landscape ? "l" : "p"} onChange={(e) => set({ ...spec, landscape: e.target.value === "l" })}>
          <option value="p">Portrait</option>
          <option value="l">Paysage</option>
        </select>
      </Field>
    </>
  );
}

export function NewDialog({ initial, onCancel, onOk }: { initial: PageSpec; onCancel: () => void; onOk: (s: PageSpec) => void }) {
  const [spec, setSpec] = useState(initial);
  return (
    <Modal title="Nouveau document" onClose={onCancel} actions={<><button onClick={onCancel}>Annuler</button><button className="primary" onClick={() => onOk(spec)}>Créer</button></>}>
      <FormatFields spec={spec} set={setSpec} />
    </Modal>
  );
}

export function BlankPagesDialog({ initial, onCancel, onOk }: { initial: PageSpec; onCancel: () => void; onOk: (s: PageSpec | "same", count: number) => void }) {
  const [same, setSame] = useState(true);
  const [spec, setSpec] = useState(initial);
  const [count, setCount] = useState(1);
  return (
    <Modal title="Insérer des pages vierges" onClose={onCancel} actions={<><button onClick={onCancel}>Annuler</button><button className="primary" onClick={() => onOk(same ? "same" : spec, count)}>Insérer</button></>}>
      <Field label="Nombre"><input type="number" min={1} max={500} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} /></Field>
      <label className="check"><input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} /> Même taille que la page courante</label>
      {!same && <FormatFields spec={spec} set={setSpec} />}
    </Modal>
  );
}

export function PasswordPrompt({ retry, onSubmit, onCancel }: { retry: boolean; onSubmit: (p: string) => void; onCancel: () => void }) {
  const [v, setV] = useState("");
  return (
    <Modal title="Document protégé" onClose={onCancel} actions={<><button onClick={onCancel}>Annuler</button><button className="primary" onClick={() => onSubmit(v)}>Ouvrir</button></>}>
      <p>{retry ? "Mot de passe incorrect. Essayez de nouveau." : "Ce document est protégé par un mot de passe."}</p>
      <input type="password" value={v} aria-label="Mot de passe" onChange={(e) => setV(e.target.value)} />
    </Modal>
  );
}

export function ProtectDialog({ protectedNow, onCancel, onOk }: { protectedNow: boolean; onCancel: () => void; onOk: (password: string | null) => void }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const mismatch = a !== b;
  return (
    <Modal title="Mot de passe du document" onClose={onCancel} actions={<>
      {protectedNow && <button onClick={() => onOk(null)}>Retirer la protection</button>}
      <button onClick={onCancel}>Annuler</button>
      <button className="primary" disabled={!a || mismatch} onClick={() => onOk(a)}>Appliquer</button>
    </>}>
      <p>{protectedNow ? "Ce document est protégé. Indiquez un nouveau mot de passe, ou retirez la protection." : "Le document sera chiffré (AES-256) à l'enregistrement ; le mot de passe sera demandé à l'ouverture."}</p>
      <Field label="Mot de passe"><input type="password" value={a} onChange={(e) => setA(e.target.value)} /></Field>
      <Field label="Confirmer"><input type="password" value={b} onChange={(e) => setB(e.target.value)} /></Field>
      {mismatch && b && <p className="error-text">Les deux mots de passe diffèrent.</p>}
      <p className="hint">Un mot de passe oublié ne peut pas être récupéré.</p>
    </Modal>
  );
}

export function MetadataDialog({ initial, onCancel, onOk, facts }: { initial: Metadata; onCancel: () => void; onOk: (m: Metadata) => void; facts: [string, string][] }) {
  const [m, setM] = useState(initial);
  const f = (k: keyof Metadata) => ({ value: m[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setM({ ...m, [k]: e.target.value }) });
  return (
    <Modal title="Propriétés du document" onClose={onCancel} actions={<><button onClick={onCancel}>Annuler</button><button className="primary" onClick={() => onOk(m)}>Appliquer</button></>}>
      <Field label="Titre"><input {...f("title")} /></Field>
      <Field label="Auteur"><input {...f("author")} /></Field>
      <Field label="Sujet"><input {...f("subject")} /></Field>
      <Field label="Mots-clés"><input {...f("keywords")} placeholder="séparés par des virgules" /></Field>
      <dl className="facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </Modal>
  );
}

const hexOf = (c: Rgb) => "#" + c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
export const rgbOf = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;

type Scope = "all" | "selection";
const ScopeField = ({ scope, set, count }: { scope: Scope; set: (s: Scope) => void; count: number }) => (
  <Field label="Pages">
    <select value={scope} onChange={(e) => set(e.target.value as Scope)}>
      <option value="all">Toutes les pages</option>
      <option value="selection">{count > 1 ? `Les ${count} pages sélectionnées` : "La page courante"}</option>
    </select>
  </Field>
);

export function NumberingDialog({ selected, onCancel, onOk }: { selected: number; onCancel: () => void; onOk: (o: NumberingOptions, scope: Scope) => void }) {
  const [o, setO] = useState<NumberingOptions>({ template: "{n} / {t}", position: "bottom-center", size: 10, margin: 28, start: 1, color: [0.2, 0.2, 0.2] });
  const [scope, setScope] = useState<Scope>("all");
  return (
    <Modal title="Numéroter les pages" onClose={onCancel} actions={<><button onClick={onCancel}>Annuler</button><button className="primary" disabled={!o.template.trim()} onClick={() => onOk(o, scope)}>Appliquer</button></>}>
      <ScopeField scope={scope} set={setScope} count={selected} />
      <Field label="Modèle"><input value={o.template} onChange={(e) => setO({ ...o, template: e.target.value })} /></Field>
      <p className="hint">{"{n}"} : numéro ; {"{t}"} : nombre total.</p>
      <Field label="Position">
        <select value={o.position} onChange={(e) => setO({ ...o, position: e.target.value as NumberingOptions["position"] })}>
          <option value="bottom-center">En bas, au centre</option><option value="bottom-left">En bas, à gauche</option><option value="bottom-right">En bas, à droite</option>
          <option value="top-center">En haut, au centre</option><option value="top-left">En haut, à gauche</option><option value="top-right">En haut, à droite</option>
        </select>
      </Field>
      <Field label="Premier numéro"><input type="number" min={0} value={o.start} onChange={(e) => setO({ ...o, start: Number(e.target.value) || 0 })} /></Field>
      <Field label="Taille (pt)"><input type="number" min={4} max={72} value={o.size} onChange={(e) => setO({ ...o, size: Number(e.target.value) || 10 })} /></Field>
      <Field label="Marge (pt)"><input type="number" min={0} max={200} value={o.margin} onChange={(e) => setO({ ...o, margin: Number(e.target.value) || 0 })} /></Field>
      <Field label="Couleur"><input type="color" value={hexOf(o.color)} onChange={(e) => setO({ ...o, color: rgbOf(e.target.value) })} /></Field>
    </Modal>
  );
}

export function WatermarkDialog({ selected, onCancel, onOk }: { selected: number; onCancel: () => void; onOk: (o: WatermarkOptions, scope: Scope) => void }) {
  const [o, setO] = useState<WatermarkOptions>({ text: "CONFIDENTIEL", size: 60, opacity: 0.2, color: [0.7, 0.1, 0.1], diagonal: true });
  const [scope, setScope] = useState<Scope>("all");
  return (
    <Modal title="Filigrane" onClose={onCancel} actions={<><button onClick={onCancel}>Annuler</button><button className="primary" disabled={!o.text.trim()} onClick={() => onOk(o, scope)}>Appliquer</button></>}>
      <ScopeField scope={scope} set={setScope} count={selected} />
      <Field label="Texte"><input value={o.text} onChange={(e) => setO({ ...o, text: e.target.value })} /></Field>
      <Field label="Taille (pt)"><input type="number" min={8} max={300} value={o.size} onChange={(e) => setO({ ...o, size: Number(e.target.value) || 60 })} /></Field>
      <Field label="Opacité (%)"><input type="number" min={5} max={100} value={Math.round(o.opacity * 100)} onChange={(e) => setO({ ...o, opacity: Math.min(1, Math.max(0.05, Number(e.target.value) / 100)) })} /></Field>
      <Field label="Couleur"><input type="color" value={hexOf(o.color)} onChange={(e) => setO({ ...o, color: rgbOf(e.target.value) })} /></Field>
      <label className="check"><input type="checkbox" checked={o.diagonal} onChange={(e) => setO({ ...o, diagonal: e.target.checked })} /> En diagonale</label>
    </Modal>
  );
}

export function CropDialog({ selected, onCancel, onOk }: { selected: number; onCancel: () => void; onOk: (m: Margins, scope: Scope) => void }) {
  const [mm, setMm] = useState({ top: 10, right: 10, bottom: 10, left: 10 });
  const [scope, setScope] = useState<Scope>("selection");
  const k = 72 / 25.4;
  const f = (n: keyof typeof mm, label: string) => <Field label={label}><input type="number" min={0} value={mm[n]} onChange={(e) => setMm({ ...mm, [n]: Math.max(0, Number(e.target.value) || 0) })} /></Field>;
  return (
    <Modal title="Recadrer" onClose={onCancel} actions={<><button onClick={onCancel}>Annuler</button><button className="primary" onClick={() => onOk({ top: mm.top * k, right: mm.right * k, bottom: mm.bottom * k, left: mm.left * k }, scope)}>Recadrer</button></>}>
      <ScopeField scope={scope} set={setScope} count={selected} />
      {f("top", "Haut (mm)")}{f("bottom", "Bas (mm)")}{f("left", "Gauche (mm)")}{f("right", "Droite (mm)")}
      <p className="hint">Le contenu hors du cadre est masqué, pas effacé du fichier.</p>
    </Modal>
  );
}

export interface MergeItem {
  key: string;
  name: string;
  path: string | null;
  pages: string;
  count: number | null;
}

export function MergeDialog({ currentName, loadCount, onCancel, onOk }: {
  currentName: string;
  loadCount: (path: string | null) => Promise<number>;
  onCancel: () => void;
  onOk: (items: MergeItem[], bookmarks: boolean) => void;
}) {
  const [items, setItems] = useState<MergeItem[]>([]);
  const [bookmarks, setBookmarks] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const add = async (path: string | null) => {
    const key = `m${++seq.current}`;
    const name = path ? fileName(path) : currentName;
    setItems((l) => [...l, { key, name, path, pages: "", count: null }]);
    try {
      const count = await loadCount(path);
      setItems((l) => l.map((i) => (i.key === key ? { ...i, count } : i)));
    } catch (e) {
      setItems((l) => l.filter((i) => i.key !== key));
      setError(`${name} : ${(e as Error).message}`);
    }
  };
  const pick = async () => {
    const r = await openDialog({ multiple: true, filters: PDF_FILTER });
    if (!r) return;
    setError(null);
    for (const f of Array.isArray(r) ? r : [r]) await add(f);
  };
  const move = (i: number, d: number) =>
    setItems((l) => {
      const n = [...l];
      const [x] = n.splice(i, 1);
      n.splice(i + d, 0, x);
      return n;
    });
  const invalid = items.some((i) => {
    if (!i.pages.trim() || i.count === null) return false;
    try {
      parseRanges(i.pages, i.count);
      return false;
    } catch {
      return true;
    }
  });
  const ready = items.length >= 2 && !invalid && items.every((i) => i.count !== null);
  return (
    <Modal title="Fusionner des PDF" width={620} onClose={onCancel} actions={<><button onClick={onCancel}>Annuler</button><button className="primary" disabled={!ready} onClick={() => onOk(items, bookmarks)}>Fusionner…</button></>}>
      <div className="merge-tools">
        <button onClick={() => void pick()}><Icon name="plus" size={14} /> Ajouter des fichiers…</button>
        <button onClick={() => void add(null)}>Ajouter le document ouvert</button>
      </div>
      {error && <p className="error-text">{error}</p>}
      <ul className="merge-list">
        {items.length === 0 && <li className="empty">Ajoutez au moins deux fichiers. Ils seront réunis dans cet ordre.</li>}
        {items.map((it, i) => (
          <li key={it.key}>
            <span className="merge-name" title={it.path ?? it.name}>{it.name}</span>
            <span className="merge-count">{it.count === null ? "…" : `${it.count} p.`}</span>
            <input className="merge-pages" placeholder="toutes" title="Pages à garder, par exemple 1-3, 5" value={it.pages} onChange={(e) => setItems((l) => l.map((x) => (x.key === it.key ? { ...x, pages: e.target.value } : x)))} />
            <button title="Monter" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" size={14} /></button>
            <button title="Descendre" disabled={i === items.length - 1} onClick={() => move(i, 1)}><Icon name="down" size={14} /></button>
            <button title="Retirer" onClick={() => setItems((l) => l.filter((x) => x.key !== it.key))}><Icon name="close" size={14} /></button>
          </li>
        ))}
      </ul>
      {invalid && <p className="error-text">Une plage de pages est invalide (exemple : 1-3, 5).</p>}
      <label className="check"><input type="checkbox" checked={bookmarks} onChange={(e) => setBookmarks(e.target.checked)} /> Créer un signet par fichier</label>
      <p className="hint">Les signets et les champs de formulaire des fichiers d'origine ne sont pas repris.</p>
    </Modal>
  );
}

export type SplitMode = { kind: "every"; n: number } | { kind: "ranges"; text: string };

export function SplitDialog({ pageCount, onCancel, onOk }: { pageCount: number; onCancel: () => void; onOk: (m: SplitMode) => void }) {
  const [kind, setKind] = useState<"every" | "ranges">("every");
  const [n, setN] = useState(1);
  const [text, setText] = useState("");
  let err: string | null = null;
  if (kind === "ranges" && text.trim()) {
    try {
      text.split("/").forEach((g) => parseRanges(g, pageCount));
    } catch (e) {
      err = (e as Error).message;
    }
  }
  const ok = kind === "every" ? n >= 1 : !!text.trim() && !err;
  return (
    <Modal title="Découper le document" onClose={onCancel} actions={<><button onClick={onCancel}>Annuler</button><button className="primary" disabled={!ok} onClick={() => onOk(kind === "every" ? { kind, n } : { kind, text })}>Choisir le dossier…</button></>}>
      <p>Le document a {pageCount} page{pageCount > 1 ? "s" : ""}. Il n'est pas modifié : les fichiers sont créés dans le dossier de votre choix.</p>
      <label className="check"><input type="radio" checked={kind === "every"} onChange={() => setKind("every")} /> Un fichier toutes les <input type="number" className="inline" min={1} max={Math.max(1, pageCount)} value={n} onChange={(e) => { setKind("every"); setN(Math.max(1, Number(e.target.value) || 1)); }} /> page(s)</label>
      <label className="check"><input type="radio" checked={kind === "ranges"} onChange={() => setKind("ranges")} /> Selon des groupes de pages</label>
      {kind === "ranges" && <input value={text} placeholder="1-3 / 4-6, 9 / 10-" aria-label="Groupes de pages" onChange={(e) => setText(e.target.value)} />}
      {kind === "ranges" && <p className="hint">Un fichier par groupe ; groupes séparés par « / ».</p>}
      {err && <p className="error-text">{err}</p>}
    </Modal>
  );
}

export function ExtractDialog({ initial, pageCount, onCancel, onOk }: { initial: string; pageCount: number; onCancel: () => void; onOk: (r: string) => void }) {
  const [text, setText] = useState(initial);
  let err: string | null = null;
  try {
    parseRanges(text, pageCount);
  } catch (e) {
    err = (e as Error).message;
  }
  return (
    <Modal title="Extraire des pages" onClose={onCancel} actions={<><button onClick={onCancel}>Annuler</button><button className="primary" disabled={!!err} onClick={() => onOk(text)}>Extraire…</button></>}>
      <Field label="Pages"><input value={text} onChange={(e) => setText(e.target.value)} /></Field>
      {err && text.trim() && <p className="error-text">{err}</p>}
      <p className="hint">Un nouveau fichier est créé ; le document ouvert ne change pas.</p>
    </Modal>
  );
}

export function PrintDialog({ onCancel, onOk, onSystem }: { onCancel: () => void; onOk: (o: { printer: string; copies: number; pages: string }) => void; onSystem: () => void }) {
  const [printers, setPrinters] = useState<Printer[] | null>(null);
  const [printer, setPrinter] = useState("");
  const [copies, setCopies] = useState(1);
  const [pages, setPages] = useState("");
  useEffect(() => {
    void api.printers().then((l) => {
      setPrinters(l);
      setPrinter(l.find((p) => p.default)?.name ?? l[0]?.name ?? "");
    });
  }, []);
  return (
    <Modal title="Imprimer" onClose={onCancel} actions={<>
      <button onClick={onSystem}>Ouvrir dans l'aperçu du système</button>
      <button onClick={onCancel}>Annuler</button>
      <button className="primary" disabled={!printer} onClick={() => onOk({ printer, copies, pages })}>Imprimer</button>
    </>}>
      {printers === null ? <p>Recherche des imprimantes…</p> : printers.length === 0 ? <p>Aucune imprimante n'est configurée.</p> : (
        <>
          <Field label="Imprimante"><select value={printer} onChange={(e) => setPrinter(e.target.value)}>{printers.map((p) => <option key={p.name} value={p.name}>{p.name}{p.default ? " (par défaut)" : ""}</option>)}</select></Field>
          <Field label="Copies"><input type="number" min={1} max={999} value={copies} onChange={(e) => setCopies(Math.max(1, Number(e.target.value) || 1))} /></Field>
          <Field label="Pages"><input value={pages} placeholder="toutes (exemple : 1-3, 5)" onChange={(e) => setPages(e.target.value)} /></Field>
        </>
      )}
    </Modal>
  );
}

export function Confirm({ title, text, buttons, onChoice }: { title: string; text: string; buttons: { id: string; label: string; primary?: boolean }[]; onChoice: (id: string | null) => void }) {
  return (
    <Modal title={title} onClose={() => onChoice(null)} actions={buttons.map((b) => <button key={b.id} className={b.primary ? "primary" : ""} onClick={() => onChoice(b.id)}>{b.label}</button>)}>
      <p>{text}</p>
    </Modal>
  );
}

export function AboutDialog({ version, onClose }: { version: string; onClose: () => void }) {
  return (
    <Modal title="À propos d'AuxiPDFWriter" onClose={onClose} actions={<button className="primary" onClick={onClose}>Fermer</button>}>
      <div className="about">
        <img src="/auxipdfwriter.svg" alt="" width={64} height={64} />
        <div>
          <strong>AuxiPDFWriter {version}</strong>
          <p>Créer, modifier et fusionner des documents PDF.</p>
          <p className="hint">© 2026 Projet AuxiNux. Composants : PDF.js (Mozilla, Apache 2.0), pdf-lib (MIT), lopdf (MIT).</p>
        </div>
      </div>
    </Modal>
  );
}
