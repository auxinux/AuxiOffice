// Boîte « Imprimer » : imprimante, pages, copies, recto verso, couleur.
// Le document est exporté en PDF par le moteur puis envoyé au service
// d'impression du système ; « Aperçu du système » ouvre ce PDF dans
// l'application d'aperçu (Aperçu sous macOS), avec sa propre impression.

import { useEffect, useState } from "react";
import { listPrinters, printDocument, printFile, printWithSystem, type Printer } from "./engine";

interface Props {
  doc: number;
  /** AuxiPDF : le PDF à imprimer tel quel (sans passer par le moteur). */
  file?: () => Promise<string>;
  title: string;
  onClose: () => void;
  onMessage: (text: string, kind?: "info" | "error") => void;
}

/** Plage de pages saisie : « 1-3, 5 » ; vide = toutes. */
export function validPageRange(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  return t.split(/[,;]/).every((part) => /^\s*\d+\s*(-\s*\d+\s*)?$/.test(part) && part.split("-").map(Number).every((n) => n >= 1));
}

export function PrintDialog({ doc, file, title, onClose, onMessage }: Props) {
  const [printers, setPrinters] = useState<Printer[] | null>(null);
  const [printer, setPrinter] = useState("");
  const [all, setAll] = useState(true);
  const [range, setRange] = useState("");
  const [copies, setCopies] = useState(1);
  const [sides, setSides] = useState("one-sided");
  const [mono, setMono] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listPrinters().then((ps) => {
      setPrinters(ps);
      setPrinter(ps.find((p) => p.default)?.name ?? ps[0]?.name ?? "");
    });
  }, []);

  const pages = all ? "" : range;
  const rangeOk = all || (range.trim() !== "" && validPageRange(range));

  const run = async (system: boolean) => {
    setBusy(true);
    try {
      if (system) {
        await printWithSystem(doc, title, pages);
        onMessage("Document ouvert dans l'aperçu du système pour impression.");
      } else {
        const options = { printer, copies, sides, monochrome: mono };
        const job = file ? await printFile(await file(), pages, options) : await printDocument(doc, title, pages, options);
        onMessage(job ? `Impression envoyée (${job}).` : "Impression envoyée.");
      }
      onClose();
    } catch (e) {
      onMessage(`Impression impossible : ${e}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="print-dialog" role="dialog" aria-label="Imprimer" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="lo-title">
          <span>Imprimer — {title}</span>
          <button title="Fermer" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="print-body">
          <label>
            Imprimante
            {printers === null ? (
              <span className="muted">Recherche des imprimantes…</span>
            ) : printers.length ? (
              <select value={printer} onChange={(e) => setPrinter(e.target.value)}>
                {printers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name.replace(/_/g, " ")}
                    {p.default ? " (par défaut)" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <span className="muted">Aucune imprimante trouvée : utilisez « Aperçu du système ».</span>
            )}
          </label>
          <fieldset>
            <legend>Pages</legend>
            <label className="inline">
              <input type="radio" checked={all} onChange={() => setAll(true)} /> Toutes
            </label>
            <label className="inline">
              <input type="radio" checked={!all} onChange={() => setAll(false)} /> Pages :
              <input
                className={`range ${rangeOk ? "" : "bad"}`}
                value={range}
                placeholder="ex. 1-3, 5"
                onFocus={() => setAll(false)}
                onChange={(e) => setRange(e.target.value)}
              />
            </label>
          </fieldset>
          <div className="print-row">
            <label>
              Copies
              <input type="number" min={1} max={999} value={copies} onChange={(e) => setCopies(Math.max(1, Math.min(999, Number(e.target.value) || 1)))} />
            </label>
            <label>
              Recto verso
              <select value={sides} onChange={(e) => setSides(e.target.value)}>
                <option value="one-sided">Non (recto seul)</option>
                <option value="two-sided-long-edge">Oui, reliure bord long</option>
                <option value="two-sided-short-edge">Oui, reliure bord court</option>
              </select>
            </label>
            <label>
              Couleur
              <select value={mono ? "mono" : "color"} onChange={(e) => setMono(e.target.value === "mono")}>
                <option value="color">Couleur</option>
                <option value="mono">Noir et blanc</option>
              </select>
            </label>
          </div>
        </div>
        <div className="print-actions">
          {!file && (
            <button className="secondary" disabled={busy || !rangeOk} onClick={() => void run(true)} title="Ouvre le PDF dans l'aperçu du système, avec toutes ses options d'impression">
              Aperçu du système…
            </button>
          )}
          <span className="spacer-flex" />
          <button className="secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="primary" disabled={busy || !rangeOk || !printer} onClick={() => void run(false)}>
            {busy ? "Préparation…" : "Imprimer"}
          </button>
        </div>
      </div>
    </div>
  );
}
