// Mot de passe d'un document chiffré, demandé à l'ouverture. Boîte autonome
// (sa propre racine React) : askPassword() la montre et rend la saisie, ou
// null si l'utilisateur annule.

import { useState } from "react";
import { createRoot } from "react-dom/client";

/** Erreur du moteur pour un document chiffré : « requis » ou « incorrect ». */
export function passwordError(e: unknown): "requis" | "incorrect" | null {
  const m = /^mot de passe (requis|incorrect)$/.exec(String(e).trim());
  return m ? (m[1] as "requis" | "incorrect") : null;
}

function PasswordDialog({ name, wrong, onDone }: { name: string; wrong: boolean; onDone: (pw: string | null) => void }) {
  const [pw, setPw] = useState("");
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onDone(null)}>
      <form
        className="print-dialog"
        role="dialog"
        aria-label="Mot de passe"
        onSubmit={(e) => {
          e.preventDefault();
          if (pw) onDone(pw);
        }}
        onKeyDown={(e) => e.key === "Escape" && onDone(null)}
      >
        <div className="lo-title">
          <span>Document protégé — {name}</span>
          <button type="button" title="Fermer" onClick={() => onDone(null)}>
            ×
          </button>
        </div>
        <div className="print-body">
          <label>
            {wrong ? "Mot de passe incorrect. Essayez de nouveau :" : "Ce document est protégé par un mot de passe :"}
            <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Mot de passe" />
          </label>
        </div>
        <div className="print-actions">
          <span className="spacer-flex" />
          <button type="button" className="secondary" onClick={() => onDone(null)}>
            Annuler
          </button>
          <button type="submit" className="primary" disabled={!pw}>
            Ouvrir
          </button>
        </div>
      </form>
    </div>
  );
}

/** Demande le mot de passe de `name` ; null : annulé. */
export function askPassword(name: string, wrong: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (pw: string | null) => {
      root.unmount();
      host.remove();
      resolve(pw);
    };
    root.render(<PasswordDialog name={name} wrong={wrong} onDone={done} />);
  });
}
