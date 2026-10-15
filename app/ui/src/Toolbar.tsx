// Barre d'outils de l'éditeur, adaptée au type de document. Toutes les
// actions passent par des commandes UNO de LibreOffice.

import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { call, type DocType } from "./engine";
import { Icon, type IconName } from "./icons";
import { colorToLong, toFileUrl } from "./lok";

type Cmd = (cmd: string, args?: Record<string, unknown>) => void;

interface Props {
  type: DocType;
  doc: number;
  states: Record<string, string>;
  command: Cmd;
  save: () => void;
  exportPdf: () => void;
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

export function Toolbar({ type, doc, states, command, save, exportPdf }: Props) {
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
  const slides = type === "presentation" || type === "drawing";

  const insertImage = async () => {
    const path = await open({ multiple: false, filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "tif", "tiff"] }] });
    if (typeof path === "string") command(".uno:InsertGraphic", { FileName: { type: "string", value: toFileUrl(path) } });
  };

  return (
    <div className="toolbar" role="toolbar">
      <div className="group">
        <Btn icon="save" title="Enregistrer (Ctrl+S)" onClick={save} />
        <Btn icon="pdf" title="Exporter en PDF" onClick={exportPdf} />
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
      </div>

      {text && (
        <div className="group">
          <Btn icon="table" title="Insérer un tableau (3 × 3)" onClick={() => command(".uno:InsertTable", { Columns: { type: "long", value: 3 }, Rows: { type: "long", value: 3 } })} />
          <Btn icon="image" title="Insérer une image" onClick={() => void insertImage()} />
          <Btn icon="pagebreak" title="Saut de page" onClick={() => command(".uno:InsertPagebreak")} />
          <Btn icon="track" title="Suivi des modifications" active={on(states, ".uno:TrackChanges")} onClick={() => command(".uno:TrackChanges")} />
        </div>
      )}

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

      {slides && (
        <div className="group">
          <Btn icon="slideAdd" title="Nouvelle diapositive" onClick={() => command(".uno:InsertPage")} />
          <Btn icon="slideDup" title="Dupliquer la diapositive" onClick={() => command(".uno:DuplicatePage")} />
          <Btn icon="slideDel" title="Supprimer la diapositive" onClick={() => command(".uno:DeletePage")} />
          <Btn icon="image" title="Insérer une image" onClick={() => void insertImage()} />
        </div>
      )}

    </div>
  );
}
