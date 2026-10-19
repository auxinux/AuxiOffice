// Accueil. Dans AuxiOffice (le gestionnaire) : les trois applications, ouvrir
// un fichier, tous les documents récents. Dans AuxiWriter, AuxiSheet ou
// AuxiPresent : un document vierge, ouvrir, les documents récents de ce type.

import { APP_DOC, APP_NAMES, type AppKind } from "./actions";
import { Icon } from "./icons";
import { fileName } from "./lok";

type DocKind = "text" | "spreadsheet" | "presentation";

interface Props {
  app: AppKind;
  recents: string[];
  onNew: (kind: DocKind) => void;
  onOpen: () => void;
  onOpenPath: (path: string) => void;
}

const KINDS = [
  { kind: "text", app: "writer", label: "Document texte", blank: "Document vierge", icon: "/icons/auxiwriter.svg", exts: ["docx", "doc", "odt", "rtf", "txt", "dotx", "ott"] },
  { kind: "spreadsheet", app: "sheet", label: "Classeur", blank: "Classeur vierge", icon: "/icons/auxisheet.svg", exts: ["xlsx", "xls", "ods", "csv", "xlsm", "xltx", "ots"] },
  { kind: "presentation", app: "present", label: "Présentation", blank: "Présentation vierge", icon: "/icons/auxipresent.svg", exts: ["pptx", "ppt", "odp", "ppsx", "potx", "otp", "odg"] },
] as const;

const extOf = (p: string) => p.split(".").pop()?.toLowerCase() ?? "";

function iconFor(path: string) {
  const ext = extOf(path);
  if ((KINDS[1].exts as readonly string[]).includes(ext)) return "/icons/mime-spreadsheet.svg";
  if ((KINDS[2].exts as readonly string[]).includes(ext)) return "/icons/mime-presentation.svg";
  return "/icons/mime-document.svg";
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

export function Home({ app, recents, onNew, onOpen, onOpenPath }: Props) {
  const own = KINDS.find((k) => k.kind === APP_DOC[app]);
  const list = recentsFor(app, recents);
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
        <h2>Nouveau</h2>
        <div className="new-grid">
          {(own ? [own] : KINDS).map((k) => (
            <button key={k.kind} className="new-card" onClick={() => onNew(k.kind)}>
              <img src={k.icon} alt="" />
              <span className="label">{own ? k.blank : k.label}</span>
              <span className="app">{APP_NAMES[k.app]}</span>
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
        {APP_NAMES[app]} · <a href="https://office.auxinux.ca" target="_blank" rel="noreferrer">office.auxinux.ca</a> · Moteur de documents : LibreOffice
      </footer>
    </div>
  );
}
