// Ruban de l'éditeur : onglet Accueil (mise en forme courante) et onglets
// thématiques (Insertion, Mise en page…) construits depuis actions.ts.
// Toutes les actions passent par des commandes UNO de LibreOffice ou par
// les actions de l'application.

import { useEffect, useState } from "react";
import { A, ribbonFor, type Action } from "./actions";
import { call, type DocType } from "./engine";
import { hasIcon, Icon, type IconName } from "./icons";
import { colorToLong } from "./lok";

type Cmd = (cmd: string, args?: Record<string, unknown>) => void;

interface Props {
  type: DocType;
  doc: number;
  states: Record<string, string>;
  command: Cmd;
  run: (a: Action) => void;
}

const SIZES = ["8", "9", "10", "10.5", "11", "12", "14", "16", "18", "20", "24", "28", "32", "36", "48", "72"];

/** Noms d'affichage français des styles de paragraphe courants. */
const STYLE_FR: Record<string, string> = {
  Standard: "Style par défaut",
  "Default Paragraph Style": "Style par défaut",
  "Text Body": "Corps de texte",
  "Body Text": "Corps de texte",
  Title: "Titre principal",
  Subtitle: "Sous-titre",
  "Heading 1": "Titre 1",
  "Heading 2": "Titre 2",
  "Heading 3": "Titre 3",
  "Heading 4": "Titre 4",
  Quotations: "Citation",
  "Preformatted Text": "Texte préformaté",
  Caption: "Légende",
  "List Bullet": "Liste à puces",
  "List Number": "Liste numérotée",
};
const STYLE_ORDER = ["Standard", "Text Body", "Title", "Subtitle", "Heading 1", "Heading 2", "Heading 3", "Heading 4", "Quotations", "Preformatted Text", "Caption"];

const on = (states: Record<string, string>, cmd: string) => states[cmd] === "true";
const disabled = (states: Record<string, string>, cmd: string) => states[cmd] === "disabled";

function Btn(p: { label?: string; icon?: IconName; title: string; onClick: () => void; active?: boolean; disabled?: boolean; className?: string }) {
  return (
    <button
      className={`tb ${p.active ? "on" : ""} ${p.className ?? ""}`}
      title={p.title}
      aria-label={p.title}
      aria-pressed={p.active}
      disabled={p.disabled}
      onMouseDown={(e) => e.preventDefault()} // garder le focus dans le document
      onClick={p.onClick}
    >
      {p.icon ? <Icon name={p.icon} /> : p.label}
    </button>
  );
}

/** Bouton du ruban : icône au-dessus du libellé. */
function RibbonBtn({ action, states, run }: { action: Action; states: Record<string, string>; run: (a: Action) => void }) {
  const label = action.label.replace(/…$/, "");
  const active = action.check ? states[action.check] === "true" : false;
  return (
    <button
      className={`rb ${active ? "on" : ""}`}
      title={action.label}
      aria-pressed={action.check ? active : undefined}
      disabled={action.uno ? states[action.uno] === "disabled" : false}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => run(action)}
    >
      {hasIcon(action.icon) ? <Icon name={action.icon} size={22} /> : <span className="rb-noicon" />}
      <span className="rb-label">{label}</span>
    </button>
  );
}

export function Toolbar(props: Props) {
  const tabs = ribbonFor(props.type);
  const [tab, setTab] = useState(0);
  const current = tabs[Math.min(tab, tabs.length - 1)];
  return (
    <div className="ribbon">
      <div className="ribbon-tabs" role="tablist">
        {tabs.map((t, i) => (
          <button key={t.label} role="tab" aria-selected={i === tab} className={i === tab ? "active" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => setTab(i)}>
            {t.label}
          </button>
        ))}
      </div>
      {current.home ? (
        <HomeBar {...props} />
      ) : (
        <div className="toolbar ribbon-body" role="toolbar">
          {current.groups.map((g) => (
            <div className="rgroup" key={g.label}>
              <div className="rgroup-items">
                {g.actions.map((a) => (
                  <RibbonBtn key={a.label} action={a} states={props.states} run={props.run} />
                ))}
              </div>
              <div className="rgroup-label">{g.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HomeBar({ type, doc, states, command, run }: Props) {
  const [fonts, setFonts] = useState<string[]>([]);
  const [styles, setStyles] = useState<string[]>([]);

  useEffect(() => {
    void call<{ values: { commandValues?: Record<string, unknown> } }>(doc, "command_values", { command: ".uno:CharFontName" }).then((r) =>
      setFonts(Object.keys(r.values?.commandValues ?? {}).sort((a, b) => a.localeCompare(b))),
    );
    if (type === "text") {
      void call<{ values: { commandValues?: { ParagraphStyles?: string[] } } }>(doc, "command_values", { command: ".uno:StyleApply" }).then((r) => {
        const all = r.values?.commandValues?.ParagraphStyles ?? [];
        const first = STYLE_ORDER.filter((s) => all.includes(s));
        setStyles([...first, ...all.filter((s) => !first.includes(s)).sort()]);
      });
    }
  }, [doc, type]);

  const font = states[".uno:CharFontName"] ?? "";
  const size = states[".uno:FontHeight"] ?? "";
  const style = states[".uno:StyleApply"] ?? "";
  const text = type === "text";
  const sheet = type === "spreadsheet";

  return (
    <div className="toolbar" role="toolbar">
      <div className="group">
        <Btn icon="save" title="Enregistrer (Ctrl+S)" onClick={() => run({ label: "Enregistrer", app: "save" })} />
        <Btn icon="pdf" title="Exporter en PDF" onClick={() => run({ label: "Exporter en PDF", app: "exportPdf" })} />
        <Btn icon="undo" title="Annuler (Ctrl+Z)" onClick={() => command(".uno:Undo")} disabled={disabled(states, ".uno:Undo")} />
        <Btn icon="redo" title="Rétablir (Ctrl+Y)" onClick={() => command(".uno:Redo")} disabled={disabled(states, ".uno:Redo")} />
      </div>

      {text && (
        <div className="group">
          <select
            className="style-select"
            value={style}
            title="Style de paragraphe"
            onChange={(e) => command(".uno:StyleApply", { Style: { type: "string", value: e.target.value }, FamilyName: { type: "string", value: "ParagraphStyles" } })}
          >
            {style && !styles.includes(style) && <option value={style}>{STYLE_FR[style] ?? style}</option>}
            {styles.map((s) => (
              <option key={s} value={s}>
                {STYLE_FR[s] ?? s}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="group">
        <select
          className="font-select"
          value={font}
          title="Police"
          onChange={(e) => command(".uno:CharFontName", { "CharFontName.FamilyName": { type: "string", value: e.target.value } })}
        >
          {font && !fonts.includes(font) && <option value={font}>{font}</option>}
          {fonts.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select
          className="size-select"
          value={size}
          title="Taille"
          onChange={(e) => command(".uno:FontHeight", { "FontHeight.Height": { type: "float", value: Number(e.target.value) } })}
        >
          {size && !SIZES.includes(size) && <option value={size}>{size}</option>}
          {SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Btn label="G" className="b" title="Gras (Ctrl+B)" active={on(states, ".uno:Bold")} onClick={() => command(".uno:Bold")} />
        <Btn label="I" className="i" title="Italique (Ctrl+I)" active={on(states, ".uno:Italic")} onClick={() => command(".uno:Italic")} />
        <Btn label="S" className="u" title="Souligné (Ctrl+U)" active={on(states, ".uno:Underline")} onClick={() => command(".uno:Underline")} />
        <Btn label="ab" className="s" title="Barré" active={on(states, ".uno:Strikeout")} onClick={() => command(".uno:Strikeout")} />
        <label className="tb color" title="Couleur du texte">
          A
          <input type="color" defaultValue="#c0392b" onChange={(e) => command(".uno:Color", { Color: { type: "long", value: colorToLong(e.target.value) } })} />
        </label>
        {!sheet && (
          <label className="tb color hl" title="Surlignage">
            ab
            <input type="color" defaultValue="#ffff00" onChange={(e) => command(".uno:CharBackColor", { CharBackColor: { type: "long", value: colorToLong(e.target.value) } })} />
          </label>
        )}
      </div>

      <div className="group">
        <Btn icon="alignLeft" title="Aligner à gauche" active={on(states, ".uno:LeftPara") || on(states, ".uno:AlignLeft")} onClick={() => command(sheet ? ".uno:AlignLeft" : ".uno:LeftPara")} />
        <Btn icon="alignCenter" title="Centrer" active={on(states, ".uno:CenterPara") || on(states, ".uno:AlignHorizontalCenter")} onClick={() => command(sheet ? ".uno:AlignHorizontalCenter" : ".uno:CenterPara")} />
        <Btn icon="alignRight" title="Aligner à droite" active={on(states, ".uno:RightPara") || on(states, ".uno:AlignRight")} onClick={() => command(sheet ? ".uno:AlignRight" : ".uno:RightPara")} />
        {!sheet && <Btn icon="justify" title="Justifier" active={on(states, ".uno:JustifyPara")} onClick={() => command(".uno:JustifyPara")} />}
        {!sheet && <Btn icon="bullets" title="Liste à puces" active={on(states, ".uno:DefaultBullet")} onClick={() => command(".uno:DefaultBullet")} />}
        {!sheet && <Btn icon="numbering" title="Liste numérotée" active={on(states, ".uno:DefaultNumbering")} onClick={() => command(".uno:DefaultNumbering")} />}
        {text && <Btn icon="indentLess" title="Diminuer le retrait" onClick={() => command(".uno:DecrementIndent")} />}
        {text && <Btn icon="indentMore" title="Augmenter le retrait" onClick={() => command(".uno:IncrementIndent")} />}
        {!sheet && (
          <select className="spacing-select" title="Interligne" value="" onChange={(e) => e.target.value && command(e.target.value)}>
            <option value="">Interligne</option>
            <option value=".uno:SpacePara1">Simple</option>
            <option value=".uno:SpacePara15">1,5 ligne</option>
            <option value=".uno:SpacePara2">Double</option>
          </select>
        )}
      </div>

      <div className="group">
        <Btn label="x²" title="Exposant" active={on(states, ".uno:SuperScript")} onClick={() => command(".uno:SuperScript")} />
        <Btn label="x₂" title="Indice" active={on(states, ".uno:SubScript")} onClick={() => command(".uno:SubScript")} />
        <Btn icon="clear" title="Effacer la mise en forme" onClick={() => command(".uno:ResetAttributes")} />
        <Btn icon="font" title="Caractère…" onClick={() => run(A.fontDialog)} />
        {!sheet && <Btn icon="paragraph" title="Paragraphe…" onClick={() => run(A.paragraphDialog)} />}
        {sheet && <Btn icon="cell" title="Format des cellules…" onClick={() => run(A.cellFormat)} />}
        <Btn icon="search" title="Rechercher et remplacer (Ctrl+H)" onClick={() => run(A.find)} />
      </div>

      {sheet && (
        <div className="group">
          <Btn icon="sum" title="Somme automatique" onClick={() => command(".uno:AutoSum")} />
          <Btn icon="currency" title="Format monétaire" onClick={() => command(".uno:NumberFormatCurrency")} />
          <Btn icon="percent" title="Format pourcentage" onClick={() => command(".uno:NumberFormatPercent")} />
          <Btn label=".0" title="Ajouter une décimale" onClick={() => command(".uno:NumberFormatIncDecimals")} />
          <Btn label=".00" title="Retirer une décimale" onClick={() => command(".uno:NumberFormatDecDecimals")} />
          <Btn icon="wrap" title="Renvoyer à la ligne" active={on(states, ".uno:WrapText")} onClick={() => command(".uno:WrapText")} />
          <Btn icon="merge" title="Fusionner les cellules" active={on(states, ".uno:ToggleMergeCells")} onClick={() => command(".uno:ToggleMergeCells")} />
          <Btn icon="sort" title="Tri croissant" onClick={() => command(".uno:SortAscending")} />
          <Btn icon="filter" title="Filtre automatique" active={on(states, ".uno:DataFilterAutoFilter")} onClick={() => command(".uno:DataFilterAutoFilter")} />
          <Btn icon="rowAdd" title="Insérer une ligne au-dessus" onClick={() => command(".uno:InsertRowsBefore")} />
          <Btn icon="colAdd" title="Insérer une colonne à gauche" onClick={() => command(".uno:InsertColumnsBefore")} />
          <Btn icon="freeze" title="Figer les volets" active={on(states, ".uno:FreezePanes")} onClick={() => command(".uno:FreezePanes")} />
        </div>
      )}

    </div>
  );
}
