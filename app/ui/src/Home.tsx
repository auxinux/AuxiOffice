// Accueil. Dans AuxiOffice (le gestionnaire) : les applications, ouvrir un
// fichier, tous les documents récents. Dans AuxiWriter, AuxiSheet, AuxiPresent
// ou AuxiDraw : un document vierge, ouvrir, les documents récents de ce type.
// Dans AuxiPDF : ouvrir et les PDF récents.

import { useEffect, useState } from "react";
import { APP_DOC, APP_NAMES, type AppKind, type NewKind } from "./actions";
import { auxiCorrectStatus, type AuxiCorrectStatus } from "./engine";
import { Icon } from "./icons";
import { fileName } from "./lok";


interface Props {
  app: AppKind;
  recents: string[];
  onNew: (kind: NewKind) => void;
  onOpen: () => void;
  onOpenPath: (path: string) => void;
  onAuxiCorrect: () => void;
}

export const KINDS = [
  { kind: "text", app: "writer", label: "Document texte", blank: "Document vierge", icon: "/icons/auxiwriter.svg", mime: "/icons/mime-document.svg", exts: ["docx", "docm", "doc", "odt", "rtf", "txt", "dotx", "dotm", "ott"] },
  { kind: "spreadsheet", app: "sheet", label: "Classeur", blank: "Classeur vierge", icon: "/icons/auxisheet.svg", mime: "/icons/mime-spreadsheet.svg", exts: ["xlsx", "xlsm", "xls", "xlsb", "ods", "csv", "xltx", "xltm", "ots"] },
  { kind: "presentation", app: "present", label: "Présentation", blank: "Présentation vierge", icon: "/icons/auxipresent.svg", mime: "/icons/mime-presentation.svg", exts: ["pptx", "pptm", "ppt", "odp", "ppsx", "potx", "otp"] },
  { kind: "drawing", app: "draw", label: "Dessin", blank: "Dessin vierge", icon: "/icons/auxidraw.svg", mime: "/icons/mime-drawing.svg", exts: ["odg", "otg", "fodg", "vsdx", "vsd", "vsdm", "vdx", "cdr", "pub", "svg"] },
  { kind: "pdf", app: "pdf", label: "Document PDF", blank: null, icon: "/icons/auxipdf.svg", mime: "/icons/mime-pdf.svg", exts: ["pdf"] },
] as const;

const extOf = (p: string) => p.split(".").pop()?.toLowerCase() ?? "";

function iconFor(path: string) {
  const ext = extOf(path);
  return KINDS.find((k) => (k.exts as readonly string[]).includes(ext))?.mime ?? "/icons/mime-document.svg";
}

/** Documents récents qui reviennent à cette application. */
export function recentsFor(app: AppKind, recents: string[]) {
  const doc = APP_DOC[app];
  if (!doc) return recents;
  const k = KINDS.find((x) => x.kind === doc)!;
  const others = KINDS.filter((x) => x !== k).flatMap((x) => x.exts as readonly string[]);
  // Extension inconnue : AuxiWriter, comme pour l'ouverture.
  return recents.filter((p) => (k.exts as readonly string[]).includes(extOf(p)) || (doc === "text" && !others.includes(extOf(p))));
}

export function Home({ app, recents, onNew, onOpen, onOpenPath, onAuxiCorrect }: Props) {
  const own = KINDS.find((k) => k.kind === APP_DOC[app]);
  const list = recentsFor(app, recents);
  const [ac, setAc] = useState<AuxiCorrectStatus | null>(null);
  useEffect(() => {
    void auxiCorrectStatus().then(setAc).catch(() => setAc(null));
  }, []);
  return (
    <div className={`home app-${app}`}>
      <header>
        {own ? (
          <div className="app-title">
            <img src={own.icon} alt="" />
            <span>{APP_NAMES[app]}</span>
          </div>
        ) : (
          <img className="logo" src="/logo-light.svg" alt="AuxiOffice" />
        )}
      </header>
      <section>
        <h2>{app === "pdf" ? "Ouvrir" : "Nouveau"}</h2>
        <div className="new-grid">
          {(own ? [own] : KINDS).map(
            (k) =>
              k.blank && (
                <button key={k.kind} className="new-card" onClick={() => onNew(k.kind)}>
                  <img src={k.icon} alt="" />
                  <span className="label">{own ? k.blank : k.label}</span>
                  <span className="app">{APP_NAMES[k.app]}</span>
                </button>
              ),
          )}
          <button className="new-card open" onClick={onOpen}>
            <span className="open-icon">
              <Icon name="open" size={44} />
            </span>
            <span className="label">{app === "pdf" ? "Ouvrir un PDF…" : "Ouvrir un fichier…"}</span>
            <span className="app">Ctrl+O</span>
          </button>
        </div>
      </section>
      <section>
        <h2>Récents</h2>
        {list.length === 0 ? (
          <p className="empty">Aucun document récent. Les fichiers ouverts apparaîtront ici.</p>
        ) : (
          <ul className="recents">
            {list.map((p) => (
              <li key={p}>
                <button onClick={() => onOpenPath(p)} title={p}>
                  <img src={iconFor(p)} alt="" />
                  <span className="name">{fileName(p)}</span>
                  <span className="path">{p.slice(0, p.length - fileName(p).length)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <footer>
        {APP_NAMES[app]} · <a href="https://office.auxinux.ca" target="_blank" rel="noreferrer">office.auxinux.ca</a> ·{" "}
        {app === "pdf" ? (
          "Affichage des PDF : PDF.js (Mozilla)"
        ) : (
          <>
            Moteur de documents : LibreOffice ·{" "}
            <button className="link" onClick={onAuxiCorrect}>
              Correction : {ac?.enabledForAuxiOffice ? `AuxiCorrect ${ac.version ?? ""}${ac.options.enabled ? "" : " (désactivé)"}` : "LibreOffice"}
            </button>
          </>
        )}
      </footer>
    </div>
  );
}
