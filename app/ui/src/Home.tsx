// Accueil : créer un document, ouvrir un fichier, documents récents.

import { Icon } from "./icons";
import { fileName } from "./lok";

interface Props {
  recents: string[];
  onNew: (kind: "text" | "spreadsheet" | "presentation") => void;
  onOpen: () => void;
  onOpenPath: (path: string) => void;
}

const KINDS = [
  { kind: "text", app: "AuxiWriter", label: "Document texte", icon: "/icons/auxiwriter.svg" },
  { kind: "spreadsheet", app: "AuxiSheet", label: "Classeur", icon: "/icons/auxisheet.svg" },
  { kind: "presentation", app: "AuxiPresent", label: "Présentation", icon: "/icons/auxipresent.svg" },
] as const;

function iconFor(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["xlsx", "xls", "ods", "csv", "xlsm"].includes(ext)) return "/icons/mime-spreadsheet.svg";
  if (["pptx", "ppt", "odp", "ppsx"].includes(ext)) return "/icons/mime-presentation.svg";
  return "/icons/mime-document.svg";
}

export function Home({ recents, onNew, onOpen, onOpenPath }: Props) {
  return (
    <div className="home">
      <header>
        <img className="logo" src="/logo-light.svg" alt="AuxiOffice" />
      </header>
      <section>
        <h2>Nouveau</h2>
        <div className="new-grid">
          {KINDS.map((k) => (
            <button key={k.kind} className="new-card" onClick={() => onNew(k.kind)}>
              <img src={k.icon} alt="" />
              <span className="label">{k.label}</span>
              <span className="app">{k.app}</span>
            </button>
          ))}
          <button className="new-card open" onClick={onOpen}>
            <span className="open-icon">
              <Icon name="open" size={44} />
            </span>
            <span className="label">Ouvrir un fichier…</span>
            <span className="app">Ctrl+O</span>
          </button>
        </div>
      </section>
      <section>
        <h2>Récents</h2>
        {recents.length === 0 ? (
          <p className="empty">Aucun document récent. Les fichiers ouverts apparaîtront ici.</p>
        ) : (
          <ul className="recents">
            {recents.map((p) => (
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
        AuxiOffice · <a href="https://office.auxinux.ca" target="_blank" rel="noreferrer">office.auxinux.ca</a> · Moteur de documents : LibreOffice
      </footer>
    </div>
  );
}
