// Catalogue des commandes d'AuxiOffice, partagé par la barre de menus et le
// ruban. Une commande exécute soit une commande UNO de LibreOffice (souvent
// une boîte de dialogue : « … » dans le libellé), soit une action de
// l'application (ouvrir, enregistrer, zoom…).

import type { DocType } from "./engine";

export type AppAction =
  | "newText"
  | "newSheet"
  | "newSlides"
  | "open"
  | "save"
  | "saveAs"
  | "exportPdf"
  | "close"
  | "insertImage"
  | "zoomIn"
  | "zoomOut"
  | "zoom100"
  | "fitWidth"
  | "selectAll"
  | "about";

export interface Action {
  label: string;
  uno?: string;
  args?: Record<string, unknown>;
  app?: AppAction;
  /** Raccourci natif du menu (format Tauri, ex. « CmdOrCtrl+S ») : réservé
   * aux actions de l'application ; les raccourcis des commandes de
   * LibreOffice (Ctrl+Entrée, F7…) lui sont transmis par le clavier. */
  accel?: string;
  /** Commande UNO dont l'état « true » coche l'élément. */
  check?: string;
  /** Icône du ruban (voir icons.tsx). */
  icon?: string;
}

export type MenuEntry = Action | "-" | { submenu: string; items: MenuEntry[] };
export interface MenuDef {
  label: string;
  items: MenuEntry[];
}

const u = (label: string, uno: string, extra: Partial<Action> = {}): Action => ({ label, uno, ...extra });
const a = (label: string, app: AppAction, extra: Partial<Action> = {}): Action => ({ label, app, ...extra });

// --- Commandes communes --------------------------------------------------
export const A = {
  undo: u("Annuler", ".uno:Undo", { icon: "undo" }),
  redo: u("Rétablir", ".uno:Redo", { icon: "redo" }),
  selectAll: a("Tout sélectionner", "selectAll"),
  find: u("Rechercher et remplacer…", ".uno:SearchDialog", { icon: "search" }),
  bold: u("Gras", ".uno:Bold", { check: ".uno:Bold" }),
  italic: u("Italique", ".uno:Italic", { check: ".uno:Italic" }),
  underline: u("Souligné", ".uno:Underline", { check: ".uno:Underline" }),
  strike: u("Barré", ".uno:Strikeout", { check: ".uno:Strikeout" }),
  superscript: u("Exposant", ".uno:SuperScript", { check: ".uno:SuperScript" }),
  subscript: u("Indice", ".uno:SubScript", { check: ".uno:SubScript" }),
  upper: u("MAJUSCULES", ".uno:ChangeCaseToUpper"),
  lower: u("minuscules", ".uno:ChangeCaseToLower"),
  grow: u("Agrandir la police", ".uno:Grow"),
  shrink: u("Réduire la police", ".uno:Shrink"),
  clearFormat: u("Effacer la mise en forme", ".uno:ResetAttributes", { icon: "clear" }),
  fontDialog: u("Caractère…", ".uno:FontDialog", { icon: "font" }),
  paragraphDialog: u("Paragraphe…", ".uno:ParagraphDialog", { icon: "paragraph" }),
  hyperlink: u("Lien hypertexte…", ".uno:HyperlinkDialog", { icon: "link" }),
  comment: u("Commentaire", ".uno:InsertAnnotation", { icon: "comment" }),
  table: u("Tableau…", ".uno:InsertTable", { icon: "table" }),
  chart: u("Diagramme…", ".uno:InsertObjectChart", { icon: "chart" }),
  image: a("Image…", "insertImage", { icon: "image" }),
  zoomIn: a("Zoom avant", "zoomIn", { icon: "zoomIn" }),
  zoomOut: a("Zoom arrière", "zoomOut", { icon: "zoomOut" }),
  zoom100: a("Taille réelle (100 %)", "zoom100"),
  fitWidth: a("Ajuster à la largeur", "fitWidth", { icon: "fit" }),
  // Writer
  pageStyle: u("Style de page…", ".uno:PageDialog", { icon: "page" }),
  columns: u("Colonnes…", ".uno:FormatColumns", { icon: "columns" }),
  bullets: u("Puces et numérotation…", ".uno:BulletsAndNumberingDialog", { icon: "bullets" }),
  editStyle: u("Modifier le style…", ".uno:EditStyle"),
  pageBreak: u("Saut de page", ".uno:InsertPagebreak", { icon: "pagebreak" }),
  otherBreak: u("Autre saut…", ".uno:InsertBreak"),
  bookmark: u("Signet…", ".uno:InsertBookmark", { icon: "bookmark" }),
  footnote: u("Note de bas de page", ".uno:InsertFootnote", { icon: "footnote" }),
  endnote: u("Note de fin", ".uno:InsertEndnote"),
  pageNumber: u("Numéro de page", ".uno:InsertPageNumberField", { icon: "pagenumber" }),
  dateField: u("Date", ".uno:InsertDateField"),
  field: u("Champ…", ".uno:InsertFieldCtrl"),
  toc: u("Table des matières et index…", ".uno:InsertMultiIndex", { icon: "toc" }),
  section: u("Section…", ".uno:InsertSection"),
  spacing1: u("Interligne simple", ".uno:SpacePara1"),
  spacing15: u("Interligne 1,5", ".uno:SpacePara15"),
  spacing2: u("Interligne double", ".uno:SpacePara2"),
  indentMore: u("Augmenter le retrait", ".uno:IncrementIndent", { icon: "indentMore" }),
  indentLess: u("Diminuer le retrait", ".uno:DecrementIndent", { icon: "indentLess" }),
  tableRowsAbove: u("Insérer des lignes au-dessus", ".uno:InsertRowsBefore"),
  tableRowsBelow: u("Insérer des lignes en dessous", ".uno:InsertRowsAfter"),
  tableColsBefore: u("Insérer des colonnes avant", ".uno:InsertColumnsBefore"),
  tableColsAfter: u("Insérer des colonnes après", ".uno:InsertColumnsAfter"),
  deleteRows: u("Supprimer les lignes", ".uno:DeleteRows"),
  deleteCols: u("Supprimer les colonnes", ".uno:DeleteColumns"),
  deleteTable: u("Supprimer le tableau", ".uno:DeleteTable"),
  mergeCells: u("Fusionner les cellules", ".uno:MergeCells"),
  splitCells: u("Scinder les cellules…", ".uno:SplitCell"),
  tableProps: u("Propriétés du tableau…", ".uno:TableDialog"),
  spelling: u("Orthographe et grammaire…", ".uno:SpellingAndGrammarDialog", { icon: "spell" }),
  autoSpell: u("Vérification orthographique automatique", ".uno:SpellOnline", { check: ".uno:SpellOnline" }),
  thesaurus: u("Synonymes…", ".uno:ThesaurusDialog", { icon: "thesaurus" }),
  wordCount: u("Nombre de mots…", ".uno:WordCountDialog", { icon: "count" }),
  trackChanges: u("Enregistrer les modifications", ".uno:TrackChanges", { check: ".uno:TrackChanges", icon: "track" }),
  manageChanges: u("Gérer les modifications…", ".uno:AcceptTrackedChanges", { icon: "changes" }),
  lineNumbering: u("Numérotation des lignes…", ".uno:LineNumberingDialog"),
  footnoteSettings: u("Notes de bas de page et de fin…", ".uno:FootnoteDialog"),
  chapterNumbering: u("Numérotation des chapitres…", ".uno:ChapterNumberingDialog"),
  updateAll: u("Tout mettre à jour", ".uno:UpdateAll"),
  formattingMarks: u("Marques de formatage", ".uno:ControlCodes", { check: ".uno:ControlCodes", icon: "pilcrow" }),
  // Calc
  cellFormat: u("Cellules…", ".uno:FormatCellDialog", { icon: "cell" }),
  condFormat: u("Formatage conditionnel…", ".uno:ConditionalFormatDialog", { icon: "condformat" }),
  rowHeight: u("Hauteur de ligne…", ".uno:RowHeight"),
  colWidth: u("Largeur de colonne…", ".uno:ColumnWidth"),
  optimalWidth: u("Largeur optimale…", ".uno:SetOptimalColumnWidth"),
  merge: u("Fusionner les cellules", ".uno:ToggleMergeCells", { check: ".uno:ToggleMergeCells", icon: "merge" }),
  wrap: u("Renvoyer à la ligne", ".uno:WrapText", { check: ".uno:WrapText", icon: "wrap" }),
  calcPage: u("Style de page…", ".uno:PageFormatDialog", { icon: "page" }),
  currency: u("Monétaire", ".uno:NumberFormatCurrency", { icon: "currency" }),
  percent: u("Pourcentage", ".uno:NumberFormatPercent", { icon: "percent" }),
  dateFormat: u("Date", ".uno:NumberFormatDate"),
  insertCells: u("Cellules…", ".uno:InsertCell"),
  deleteCells: u("Supprimer des cellules…", ".uno:DeleteCell"),
  rowsAbove: u("Lignes au-dessus", ".uno:InsertRowsBefore", { icon: "rowAdd" }),
  rowsBelow: u("Lignes en dessous", ".uno:InsertRowsAfter"),
  colsBefore: u("Colonnes avant", ".uno:InsertColumnsBefore", { icon: "colAdd" }),
  colsAfter: u("Colonnes après", ".uno:InsertColumnsAfter"),
  sheetInsert: u("Insérer une feuille…", ".uno:Insert", { icon: "sheetAdd" }),
  sheetDelete: u("Supprimer la feuille…", ".uno:Remove"),
  sheetRename: u("Renommer la feuille…", ".uno:RenameTable"),
  functionWizard: u("Fonction…", ".uno:FunctionDialog", { icon: "function" }),
  autoSum: u("Somme automatique", ".uno:AutoSum", { icon: "sum" }),
  currentDate: u("Date du jour", ".uno:InsertCurrentDate"),
  sort: u("Trier…", ".uno:DataSort", { icon: "sort" }),
  sortAsc: u("Tri croissant", ".uno:SortAscending"),
  sortDesc: u("Tri décroissant", ".uno:SortDescending"),
  autoFilter: u("Filtre automatique", ".uno:DataFilterAutoFilter", { check: ".uno:DataFilterAutoFilter", icon: "filter" }),
  stdFilter: u("Filtre standard…", ".uno:DataFilterStandardFilter"),
  validity: u("Validité…", ".uno:Validation", { icon: "validity" }),
  names: u("Gérer les noms…", ".uno:DefineName"),
  recalc: u("Recalculer", ".uno:Calculate"),
  freeze: u("Figer lignes et colonnes", ".uno:FreezePanes", { check: ".uno:FreezePanes", icon: "freeze" }),
  calcSpell: u("Orthographe…", ".uno:SpellDialog", { icon: "spell" }),
  // Impress
  newSlide: u("Nouvelle diapositive", ".uno:InsertPage", { icon: "slideAdd" }),
  dupSlide: u("Dupliquer la diapositive", ".uno:DuplicatePage", { icon: "slideDup" }),
  delSlide: u("Supprimer la diapositive", ".uno:DeletePage", { icon: "slideDel" }),
  slideProps: u("Propriétés de la diapositive…", ".uno:PageSetup", { icon: "page" }),
  masters: u("Diapos maîtresses…", ".uno:PresentationLayout", { icon: "master" }),
  textBox: u("Zone de texte", ".uno:Text", { icon: "textbox" }),
  headerFooter: u("En-tête et pied de page…", ".uno:HeaderAndFooter", { icon: "headerfooter" }),
  outlineBullets: u("Puces et numérotation…", ".uno:OutlineBullet", { icon: "bullets" }),
  transform: u("Position et taille…", ".uno:TransformDialog", { icon: "transform" }),
} satisfies Record<string, Action>;

// --- Barre de menus ----------------------------------------------------------
const fileMenu: MenuDef = {
  label: "Fichier",
  items: [
    { submenu: "Nouveau", items: [a("Document texte", "newText", { accel: "CmdOrCtrl+N" }), a("Classeur", "newSheet"), a("Présentation", "newSlides")] },
    a("Ouvrir…", "open", { accel: "CmdOrCtrl+O" }),
    "-",
    a("Enregistrer", "save", { accel: "CmdOrCtrl+S" }),
    a("Enregistrer sous…", "saveAs", { accel: "CmdOrCtrl+Shift+S" }),
    a("Exporter en PDF…", "exportPdf"),
    "-",
    a("Fermer le document", "close", { accel: "CmdOrCtrl+W" }),
  ],
};

const viewItems = (sheet = false): MenuEntry[] => [
  A.zoomIn,
  A.zoomOut,
  A.zoom100,
  ...(sheet ? [] : [A.fitWidth]),
];

export function menusFor(type: DocType | null): MenuDef[] {
  const editBase: MenuEntry[] = [A.undo, A.redo, "-", A.selectAll, "-", A.find];
  if (type === "text") {
    return [
      fileMenu,
      { label: "Édition", items: [...editBase, "-", { submenu: "Suivi des modifications", items: [A.trackChanges, A.manageChanges] }] },
      { label: "Affichage", items: [...viewItems(), "-", A.formattingMarks] },
      {
        label: "Insertion",
        items: [A.pageBreak, A.otherBreak, "-", A.table, A.image, A.chart, "-", A.hyperlink, A.bookmark, A.comment, "-", A.footnote, A.endnote,
          { submenu: "Champ", items: [A.pageNumber, A.dateField, A.field] }, "-", A.toc, A.section],
      },
      {
        label: "Format",
        items: [A.fontDialog, A.paragraphDialog, A.bullets, A.columns, A.pageStyle, "-",
          { submenu: "Texte", items: [A.bold, A.italic, A.underline, A.strike, "-", A.superscript, A.subscript, "-", A.upper, A.lower, "-", A.grow, A.shrink] },
          { submenu: "Interligne", items: [A.spacing1, A.spacing15, A.spacing2] },
          A.indentMore, A.indentLess, "-", A.clearFormat, A.editStyle],
      },
      {
        label: "Tableau",
        items: [A.table, "-", A.tableRowsAbove, A.tableRowsBelow, A.tableColsBefore, A.tableColsAfter, "-", A.deleteRows, A.deleteCols, A.deleteTable, "-", A.mergeCells, A.splitCells, "-", A.tableProps],
      },
      {
        label: "Outils",
        items: [A.spelling, A.autoSpell, A.thesaurus, A.wordCount, "-", A.lineNumbering, A.footnoteSettings, A.chapterNumbering, "-", A.updateAll],
      },
    ];
  }
  if (type === "spreadsheet") {
    return [
      fileMenu,
      { label: "Édition", items: [...editBase, "-", A.deleteCells] },
      { label: "Affichage", items: [...viewItems(true), "-", A.freeze] },
      { label: "Insertion", items: [A.insertCells, A.rowsAbove, A.rowsBelow, A.colsBefore, A.colsAfter, "-", A.functionWizard, A.autoSum, A.currentDate, "-", A.chart, A.image, A.hyperlink, A.comment] },
      {
        label: "Format",
        items: [A.cellFormat, A.condFormat, "-", { submenu: "Nombre", items: [A.currency, A.percent, A.dateFormat] }, A.merge, A.wrap, "-",
          { submenu: "Lignes et colonnes", items: [A.rowHeight, A.colWidth, A.optimalWidth] }, "-", A.fontDialog, A.clearFormat, A.calcPage],
      },
      { label: "Feuille", items: [A.sheetInsert, A.sheetDelete, A.sheetRename, "-", A.deleteRows, A.deleteCols] },
      { label: "Données", items: [A.sort, A.sortAsc, A.sortDesc, "-", A.autoFilter, A.stdFilter, "-", A.validity, A.names, "-", A.recalc] },
      { label: "Outils", items: [A.calcSpell] },
    ];
  }
  if (type === "presentation" || type === "drawing") {
    return [
      fileMenu,
      { label: "Édition", items: editBase },
      { label: "Affichage", items: viewItems() },
      { label: "Insertion", items: [A.newSlide, A.dupSlide, "-", A.textBox, A.image, A.table, A.chart, "-", A.hyperlink, A.comment, A.headerFooter] },
      { label: "Format", items: [A.fontDialog, A.paragraphDialog, A.outlineBullets, A.transform, "-", A.bold, A.italic, A.underline, A.strike, "-", A.clearFormat] },
      { label: "Diapositive", items: [A.newSlide, A.dupSlide, A.delSlide, "-", A.slideProps, A.masters] },
    ];
  }
  return [fileMenu];
}

// --- Ruban -------------------------------------------------------------------
export interface RibbonTab {
  label: string;
  /** « home » : onglet Accueil avec les contrôles de mise en forme. */
  home?: boolean;
  groups: { label: string; actions: Action[] }[];
}

export function ribbonFor(type: DocType): RibbonTab[] {
  if (type === "text") {
    return [
      { label: "Accueil", home: true, groups: [] },
      {
        label: "Insertion",
        groups: [
          { label: "Pages", actions: [A.pageBreak, A.section] },
          { label: "Objets", actions: [A.table, A.image, A.chart] },
          { label: "Liens", actions: [A.hyperlink, A.bookmark, A.comment] },
          { label: "Notes et champs", actions: [A.footnote, A.pageNumber, A.field, A.toc] },
        ],
      },
      {
        label: "Mise en page",
        groups: [
          { label: "Page", actions: [A.pageStyle, A.columns, A.pageBreak] },
          { label: "Paragraphe", actions: [A.paragraphDialog, A.bullets, A.indentLess, A.indentMore] },
          { label: "Caractère", actions: [A.fontDialog, A.clearFormat] },
        ],
      },
      {
        label: "Révision",
        groups: [
          { label: "Vérification", actions: [A.spelling, A.thesaurus, A.wordCount] },
          { label: "Suivi", actions: [A.trackChanges, A.manageChanges, A.comment] },
        ],
      },
      { label: "Affichage", groups: [{ label: "Zoom", actions: [A.zoomOut, A.zoomIn, A.fitWidth] }, { label: "Afficher", actions: [A.formattingMarks] }] },
    ];
  }
  if (type === "spreadsheet") {
    return [
      { label: "Accueil", home: true, groups: [] },
      {
        label: "Insertion",
        groups: [
          { label: "Cellules", actions: [A.rowsAbove, A.colsBefore, A.sheetInsert] },
          { label: "Calcul", actions: [A.autoSum, A.functionWizard] },
          { label: "Objets", actions: [A.chart, A.image, A.hyperlink, A.comment] },
        ],
      },
      {
        label: "Mise en forme",
        groups: [
          { label: "Cellules", actions: [A.cellFormat, A.condFormat, A.merge, A.wrap] },
          { label: "Nombre", actions: [A.currency, A.percent] },
          { label: "Page", actions: [A.calcPage] },
        ],
      },
      {
        label: "Données",
        groups: [
          { label: "Trier et filtrer", actions: [A.sort, A.autoFilter] },
          { label: "Outils", actions: [A.validity, A.freeze] },
        ],
      },
      { label: "Révision", groups: [{ label: "Vérification", actions: [A.calcSpell, A.comment] }] },
      { label: "Affichage", groups: [{ label: "Zoom", actions: [A.zoomOut, A.zoomIn] }, { label: "Fenêtre", actions: [A.freeze] }] },
    ];
  }
  return [
    { label: "Accueil", home: true, groups: [] },
    {
      label: "Insertion",
      groups: [
        { label: "Diapositives", actions: [A.newSlide, A.dupSlide] },
        { label: "Objets", actions: [A.textBox, A.image, A.table, A.chart] },
        { label: "Autres", actions: [A.hyperlink, A.headerFooter, A.comment] },
      ],
    },
    {
      label: "Diapositive",
      groups: [
        { label: "Diapositive", actions: [A.newSlide, A.dupSlide, A.delSlide] },
        { label: "Mise en page", actions: [A.slideProps, A.masters] },
      ],
    },
    { label: "Format", groups: [{ label: "Texte", actions: [A.fontDialog, A.paragraphDialog, A.outlineBullets] }, { label: "Objet", actions: [A.transform] }] },
    { label: "Affichage", groups: [{ label: "Zoom", actions: [A.zoomOut, A.zoomIn, A.fitWidth] }] },
  ];
}
