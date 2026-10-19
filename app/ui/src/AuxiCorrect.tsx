// AuxiCorrect dans AuxiOffice : options de correction et dictionnaire.
// AuxiCorrect est un programme séparé ; la coque l'appelle (voir auxicorrect.rs).

import { useEffect, useState } from "react";
import { auxiCorrectLookup, auxiCorrectStatus, openAuxiCorrect, setAuxiCorrectOptions, type AuxiCorrectOptions, type AuxiCorrectStatus } from "./engine";

export function AuxiCorrectOptionsDialog({ onClose, onMessage }: { onClose: () => void; onMessage: (t: string, k?: "info" | "error") => void }) {
  const [st, setSt] = useState<AuxiCorrectStatus | null>(null);
  const [toggled, setToggled] = useState(false);
  useEffect(() => {
    void auxiCorrectStatus().then(setSt);
  }, []);
  if (!st) return null;
  const o = st.options;
  const set = (patch: Partial<AuxiCorrectOptions>) => {
    const next = { ...o, ...patch };
    if (patch.enabled !== undefined) setToggled(true);
    void setAuxiCorrectOptions(next)
      .then(setSt)
      .catch((e) => onMessage(`${e}`, "error"));
  };
  const usable = st.enabledForAuxiOffice;
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="auxicorrect-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="AuxiCorrect">
        <h2>
          AuxiCorrect <span className="version">{st.version ?? ""}</span>
        </h2>
        <p className={`ac-state ${st.active ? "on" : "off"}`}>
          {!st.installed
            ? "AuxiCorrect n'est pas installé : la correction est faite par LibreOffice."
            : !usable
              ? "AuxiCorrect est installé mais pas activé pour AuxiOffice : dans AuxiCorrect, ouvrez Paramètres → Intégration, cochez AuxiOffice, puis redémarrez AuxiWriter."
              : st.writerOnly
                ? "AuxiCorrect souligne les fautes dans AuxiWriter. Ici, LibreOffice ne vérifie que l'orthographe ; le dictionnaire d'AuxiCorrect reste disponible."
                : st.active
                  ? "AuxiCorrect corrige le français de vos documents : orthographe, grammaire, typographie et particularités du français québécois."
                  : "AuxiCorrect est désactivé : la correction est faite par LibreOffice."}
        </p>
        <fieldset disabled={!usable}>
          <label className="row">
            <input type="checkbox" checked={o.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            Corriger le français avec AuxiCorrect (au lieu du correcteur de LibreOffice)
          </label>
          <div className="row">
            <span className="label">Profil</span>
            <label>
              <input type="radio" name="ac-profil" checked={!o.international} onChange={() => set({ international: false })} /> Français québécois
            </label>
            <label>
              <input type="radio" name="ac-profil" checked={o.international} onChange={() => set({ international: true })} /> Français international
            </label>
          </div>
          <div className="row">
            <span className="label">Orthographe</span>
            <select value={o.variant} onChange={(e) => set({ variant: e.target.value as AuxiCorrectOptions["variant"] })}>
              <option value="toutes">Toutes les variantes</option>
              <option value="classique">Traditionnelle</option>
              <option value="1990">Rectifiée (1990)</option>
            </select>
          </div>
          <label className="row">
            <input type="checkbox" checked={o.regional} onChange={(e) => set({ regional: e.target.checked })} />
            Signaler les particularités régionales (anglicismes, registre familier…)
          </label>
          <label className="row">
            <input type="checkbox" checked={o.style} onChange={(e) => set({ style: e.target.checked })} />
            Suggestions de style (phrases longues, répétitions…)
          </label>
        </fieldset>
        <p className="note">
          {toggled
            ? "Activer ou désactiver AuxiCorrect vaut pour les documents ouverts ensuite : fermez et rouvrez un document ouvert pour l'appliquer."
            : "Le profil et les options valent pour les paragraphes vérifiés ensuite. Le dictionnaire personnel et les mots ignorés se règlent dans AuxiCorrect."}
        </p>
        <div className="buttons">
          {st.hasApp && (
            <button onClick={() => void openAuxiCorrect().catch((e) => onMessage(`${e}`, "error"))}>Ouvrir AuxiCorrect…</button>
          )}
          <span className="spacer-flex" />
          <button className="primary" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

const TABS = [
  { what: "definir", label: "Définition" },
  { what: "synonymes", label: "Synonymes" },
  { what: "antonymes", label: "Antonymes" },
  { what: "conjuguer", label: "Conjugaison" },
] as const;

export function AuxiCorrectDictionary({ initialWord, onClose }: { initialWord: string; onClose: () => void }) {
  const [word, setWord] = useState(initialWord);
  const [query, setQuery] = useState(initialWord);
  const [tab, setTab] = useState<(typeof TABS)[number]["what"]>("definir");
  const [result, setResult] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => {
    if (!query.trim()) {
      setResult(null);
      return;
    }
    let alive = true;
    setResult({ text: "Recherche…", error: false });
    auxiCorrectLookup(tab, query)
      .then((text) => alive && setResult({ text, error: false }))
      .catch((e) => alive && setResult({ text: `${e}`, error: true }));
    return () => {
      alive = false;
    };
  }, [query, tab]);
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="auxicorrect-dialog dictionary" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Dictionnaire AuxiCorrect">
        <h2>Dictionnaire AuxiCorrect</h2>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(word.trim());
          }}
        >
          <input autoFocus value={word} onChange={(e) => setWord(e.target.value)} placeholder="Mot ou verbe" />
          <button type="submit">Chercher</button>
        </form>
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.what} className={t.what === tab ? "active" : ""} onClick={() => setTab(t.what)}>
              {t.label}
            </button>
          ))}
        </div>
        <pre className={`result ${result?.error ? "error" : ""}`}>{result?.text ?? "Saisissez un mot."}</pre>
        <div className="buttons">
          <span className="spacer-flex" />
          <button className="primary" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
