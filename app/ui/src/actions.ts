// Catalogue des commandes d'AuxiOffice, partagé par la barre de menus et le
// ruban. Une commande exécute soit une commande UNO de LibreOffice (souvent
// une boîte de dialogue : « … » dans le libellé), soit une action de
// l'application (ouvrir, enregistrer, zoom…).

import type { DocType } from "./engine";

export type AppAction =
  | "newText"
  | "newSheet"
  | "newSlides"
  | "newDrawing"
  | "exportImage"
  | "pdf"
  | "open"
  | "save"
  | "saveAs"
  | "exportPdf"
  | "print"
  | "close"
  | "insertImage"
  | "zoomIn"
  | "zoomOut"
  | "zoom100"
  | "fitWidth"
  | "selectAll"
  | "slideShow"
  | "slideShowHere"
  | "about"
  | "auxicorrectOptions"
  | "auxicorrectDictionary";

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
  // Commun
  pasteSpecial: u("Collage spécial…", ".uno:PasteSpecial"),
  docProps: u("Propriétés du document…", ".uno:SetDocumentProperties"),
  specialChar: u("Caractère spécial…", ".uno:InsertSymbol", { icon: "omega" }),
  qrCode: u("QR code et code-barres…", ".uno:InsertQrCode", { icon: "qr" }),
  fontwork: u("Fontwork…", ".uno:FontworkGalleryFloater"),
  langDocFr: u("Français (France)", ".uno:LanguageStatus?Language:string=Default_Français (France)"),
  langDocCa: u("Français (Canada)", ".uno:LanguageStatus?Language:string=Default_Français (Canada)"),
  langDocEnCa: u("Anglais (Canada)", ".uno:LanguageStatus?Language:string=Default_Anglais (Canada)"),
  langDocEnUs: u("Anglais (États-Unis)", ".uno:LanguageStatus?Language:string=Default_Anglais (États-Unis d'Amérique)"),
  langParFr: u("Français (France)", ".uno:LanguageStatus?Language:string=Paragraph_Français (France)"),
  langParCa: u("Français (Canada)", ".uno:LanguageStatus?Language:string=Paragraph_Français (Canada)"),
  langParEn: u("Anglais (Canada)", ".uno:LanguageStatus?Language:string=Paragraph_Anglais (Canada)"),
  print: a("Imprimer…", "print", { icon: "print" }),
  // AuxiCorrect (correcteur du français de l'écosystème AuxiNux)
  acCheck: u("Vérifier le document…", ".uno:SpellingAndGrammarDialog", { icon: "spell" }),
  acDictionary: a("Dictionnaire…", "auxicorrectDictionary", { icon: "thesaurus" }),
  acOptions: a("Options d'AuxiCorrect…", "auxicorrectOptions", { icon: "auxicorrect" }),
  // Writer
  gotoPage: u("Aller à la page…", ".uno:GotoPage"),
  acceptAll: u("Accepter toutes les modifications", ".uno:AcceptAllTrackedChanges"),
  rejectAll: u("Refuser toutes les modifications", ".uno:RejectAllTrackedChanges"),
  nextChange: u("Modification suivante", ".uno:NextTrackedChange"),
  showChanges: u("Afficher les modifications", ".uno:ShowTrackedChanges", { check: ".uno:ShowTrackedChanges" }),
  deleteComments: u("Supprimer tous les commentaires", ".uno:DeleteAllNotes"),
  textBoundaries: u("Limites du texte", ".uno:ViewBounds", { check: ".uno:ViewBounds" }),
  fieldShadings: u("Trame de fond des champs", ".uno:Marks", { check: ".uno:Marks" }),
  textFrame: u("Zone de texte", ".uno:DrawText", { icon: "textbox" }),
  formula: u("Formule mathématique", ".uno:InsertObjectStarMath", { icon: "function" }),
  crossRef: u("Renvoi…", ".uno:InsertReferenceField"),
  indexEntry: u("Entrée d'index…", ".uno:InsertIndexesEntry"),
  envelope: u("Enveloppe…", ".uno:InsertEnvelope"),
  titlePage: u("Pages de titre…", ".uno:TitlePageDialog"),
  newStyle: u("Nouveau style à partir de la sélection…", ".uno:StyleNewByExample"),
  theme: u("Thème…", ".uno:ThemeDialog"),
  cloneFormat: u("Cloner la mise en forme", ".uno:FormatPaintbrush", { icon: "brush" }),
  textToTable: u("Convertir le texte en tableau…", ".uno:ConvertTextToTable"),
  sortText: u("Trier…", ".uno:SortDialog"),
  hyphenate: u("Coupure des mots…", ".uno:Hyphenate"),
  autoText: u("AutoTexte…", ".uno:EditGlossary"),
  // Calc
  fillDown: u("Remplir vers le bas", ".uno:FillDown"),
  fillSeries: u("Remplir une série…", ".uno:FillSeries"),
  deleteContents: u("Supprimer du contenu…", ".uno:Delete"),
  pivot: u("Table dynamique…", ".uno:DataDataPilotRun", { icon: "pivot" }),
  currentTime: u("Heure actuelle", ".uno:InsertCurrentTime"),
  sparkline: u("Graphique sparkline…", ".uno:InsertSparkline"),
  autoFormatCells: u("Styles d'AutoFormat…", ".uno:AutoFormat"),
  hideRows: u("Masquer les lignes", ".uno:HideRow"),
  showRows: u("Afficher les lignes", ".uno:ShowRow"),
  hideCols: u("Masquer les colonnes", ".uno:HideColumn"),
  showCols: u("Afficher les colonnes", ".uno:ShowColumn"),
  optimalHeight: u("Hauteur optimale…", ".uno:SetOptimalRowHeight"),
  colorScale: u("Échelle de couleurs…", ".uno:ColorScaleFormatDialog"),
  dataBar: u("Barre de données…", ".uno:DataBarFormatDialog"),
  iconSet: u("Jeu d'icônes…", ".uno:IconSetFormatDialog"),
  manageCond: u("Gérer les formatages conditionnels…", ".uno:ConditionalFormatManagerDialog"),
  numDecimal: u("Nombre", ".uno:NumberFormatDecimal"),
  numScientific: u("Scientifique", ".uno:NumberFormatScientific"),
  numTime: u("Heure", ".uno:NumberFormatTime"),
  incDecimals: u("Ajouter une décimale", ".uno:NumberFormatIncDecimals"),
  decDecimals: u("Retirer une décimale", ".uno:NumberFormatDecDecimals"),
  sheetMove: u("Déplacer ou copier la feuille…", ".uno:Move"),
  sheetHide: u("Masquer la feuille", ".uno:Hide"),
  sheetShow: u("Afficher une feuille…", ".uno:Show"),
  sheetColor: u("Couleur d'onglet…", ".uno:SetTabBgColor"),
  sheetProtect: u("Protéger la feuille…", ".uno:Protect", { icon: "lock" }),
  bookProtect: u("Protéger la structure du classeur…", ".uno:ToolProtectionDocument"),
  subtotals: u("Sous-totaux…", ".uno:DataSubTotals"),
  textToColumns: u("Texte en colonnes…", ".uno:TextToColumns"),
  consolidate: u("Consolider…", ".uno:DataConsolidate"),
  goalSeek: u("Recherche de valeur cible…", ".uno:GoalSeekDialog"),
  group: u("Grouper…", ".uno:Group"),
  ungroup: u("Dissocier", ".uno:Ungroup"),
  removeFilter: u("Supprimer le filtre", ".uno:DataFilterRemoveFilter"),
  specialFilter: u("Filtre spécial…", ".uno:DataFilterSpecialFilter"),
  dbRange: u("Définir une plage…", ".uno:DefineDBName"),
  dataForm: u("Formulaire…", ".uno:DataForm"),
  randomNumbers: u("Nombres aléatoires…", ".uno:RandomNumberGeneratorDialog"),
  descStats: u("Statistiques descriptives…", ".uno:DescriptiveStatisticsDialog"),
  recalcHard: u("Recalcul complet", ".uno:CalculateHard"),
  showDependents: u("Repérer les dépendants", ".uno:ShowDependents"),
  showPrecedents: u("Repérer les antécédents", ".uno:ShowPrecedents"),
  clearArrows: u("Supprimer toutes les flèches", ".uno:ClearArrows"),
  calcTrack: u("Enregistrer les modifications", ".uno:TraceChangeMode", { check: ".uno:TraceChangeMode", icon: "track" }),
  calcManageChanges: u("Gérer les modifications…", ".uno:AcceptChanges", { icon: "changes" }),
  printAreaDefine: u("Définir la zone d'impression", ".uno:DefinePrintArea", { icon: "printarea" }),
  printAreaDelete: u("Effacer la zone d'impression", ".uno:DeletePrintArea"),
  printAreaEdit: u("Éditer les zones d'impression…", ".uno:EditPrintArea"),
  // Impress
  hideSlide: u("Masquer la diapositive", ".uno:HideSlide"),
  showSlide: u("Afficher la diapositive", ".uno:ShowSlide"),
  renameSlide: u("Renommer la diapositive…", ".uno:RenamePage"),
  layoutBlank: u("Vide", ".uno:AssignLayout?WhatLayout:long=20"),
  layoutTitle: u("Diapositive de titre", ".uno:AssignLayout?WhatLayout:long=0"),
  layoutContent: u("Titre, contenu", ".uno:AssignLayout?WhatLayout:long=1"),
  layoutTwo: u("Titre et 2 contenus", ".uno:AssignLayout?WhatLayout:long=3"),
  layoutTitleOnly: u("Titre seul", ".uno:AssignLayout?WhatLayout:long=19"),
  area: u("Remplissage…", ".uno:FormatArea"),
  line: u("Ligne…", ".uno:FormatLine"),
  textAttrs: u("Attributs du texte…", ".uno:TextAttributes"),
  toFront: u("Mettre au premier plan", ".uno:BringToFront"),
  toBack: u("Mettre à l'arrière-plan", ".uno:SendToBack"),
  slideNumber: u("Numéro de diapositive", ".uno:InsertPageField"),
  slideDate: u("Date", ".uno:InsertDateFieldFix"),
  shapeRect: u("Rectangle", ".uno:BasicShapes.rectangle", { icon: "rect" }),
  shapeEllipse: u("Ellipse", ".uno:BasicShapes.ellipse", { icon: "ellipse" }),
  shapeLine: u("Ligne", ".uno:Line", { icon: "lineShape" }),
  shapeArrow: u("Flèche", ".uno:ArrowShapes.right-arrow", { icon: "arrow" }),
  slideShow: a("Lancer le diaporama", "slideShow", { accel: "F5", icon: "play" }),
  slideShowHere: a("Diaporama depuis cette diapositive", "slideShowHere", { accel: "Shift+F5" }),
  // Draw
  newPage: u("Nouvelle page", ".uno:InsertPage", { icon: "slideAdd" }),
  dupPage: u("Dupliquer la page", ".uno:DuplicatePage", { icon: "slideDup" }),
  delPage: u("Supprimer la page", ".uno:DeletePage", { icon: "slideDel" }),
  renamePage: u("Renommer la page…", ".uno:RenamePage"),
  pageProps: u("Propriétés de la page…", ".uno:PageSetup", { icon: "page" }),
  layer: u("Couche…", ".uno:InsertLayer", { icon: "layers" }),
  select: u("Sélection", ".uno:SelectObject", { icon: "pointer" }),
  shapeRoundRect: u("Rectangle arrondi", ".uno:BasicShapes.round-rectangle", { icon: "roundRect" }),
  shapeTriangle: u("Triangle", ".uno:BasicShapes.isosceles-triangle", { icon: "triangle" }),
  shapeStar: u("Étoile", ".uno:StarShapes.star5", { icon: "star" }),
  shapeCallout: u("Bulle", ".uno:CalloutShapes.round-rectangular-callout", { icon: "callout" }),
  shapeFlow: u("Processus (organigramme)", ".uno:FlowChartShapes.flowchart-process", { icon: "rect" }),
  shapeDecision: u("Décision (organigramme)", ".uno:FlowChartShapes.flowchart-decision", { icon: "diamond" }),
  lineArrow: u("Ligne fléchée", ".uno:LineArrowEnd", { icon: "arrowLine" }),
  connector: u("Connecteur", ".uno:ConnectorArrowEnd", { icon: "connector" }),
  curve: u("Courbe", ".uno:Bezier_Unfilled", { icon: "curve" }),
  polygon: u("Polygone", ".uno:Polygon_Unfilled", { icon: "polygon" }),
  freeline: u("Main levée", ".uno:Freeline_Unfilled", { icon: "freehand" }),
  measure: u("Ligne de cote", ".uno:MeasureLine", { icon: "measure" }),
  groupShapes: u("Grouper", ".uno:FormatGroup", { icon: "group" }),
  ungroupShapes: u("Dissocier", ".uno:FormatUngroup", { icon: "ungroup" }),
  enterGroup: u("Entrer dans le groupe", ".uno:EnterGroup"),
  leaveGroup: u("Quitter le groupe", ".uno:LeaveGroup"),
  forward: u("Avancer d'un plan", ".uno:Forward"),
  backward: u("Reculer d'un plan", ".uno:Backward"),
  alignLeft: u("À gauche", ".uno:ObjectAlignLeft", { icon: "objLeft" }),
  alignHCenter: u("Centré", ".uno:AlignCenter", { icon: "objCenter" }),
  alignRight: u("À droite", ".uno:ObjectAlignRight", { icon: "objRight" }),
  alignTop: u("En haut", ".uno:AlignUp", { icon: "objTop" }),
  alignVCenter: u("Au milieu", ".uno:AlignMiddle", { icon: "objMiddle" }),
  alignBottom: u("En bas", ".uno:AlignDown", { icon: "objBottom" }),
  distribute: u("Répartir…", ".uno:DistributeSelection"),
  flipH: u("Retourner horizontalement", ".uno:FlipHorizontal", { icon: "flipH" }),
  flipV: u("Retourner verticalement", ".uno:FlipVertical", { icon: "flipV" }),
  rotate: u("Rotation", ".uno:ToggleObjectRotateMode", { icon: "rotate" }),
  combine: u("Combiner", ".uno:Combine"),
  merge2: u("Fusionner les formes", ".uno:Merge"),
  subtract: u("Soustraire les formes", ".uno:Substract"),
  intersect: u("Intersection des formes", ".uno:Intersect"),
  convertCurve: u("Convertir en courbe", ".uno:ChangeBezier"),
  convertPolygon: u("Convertir en polygone", ".uno:ChangePolygon"),
  shadow: u("Ombre", ".uno:FillShadow", { check: ".uno:FillShadow" }),
  grid: u("Afficher la grille", ".uno:GridVisible", { check: ".uno:GridVisible", icon: "grid" }),
  snapGrid: u("Aligner sur la grille", ".uno:GridUse", { check: ".uno:GridUse" }),
  helplines: u("Lignes de repère pendant le déplacement", ".uno:HelplinesMove", { check: ".uno:HelplinesMove" }),
  exportImage: a("Exporter en image (PNG, SVG)…", "exportImage", { icon: "image" }),
} satisfies Record<string, Action>;

// --- Barre de menus ----------------------------------------------------------
/** Application en cours : le gestionnaire AuxiOffice ou une application d'un type de document. */
export type AppKind = "office" | "writer" | "sheet" | "present" | "draw" | "pdf";

export const APP_NAMES: Record<AppKind, string> = { office: "AuxiOffice", writer: "AuxiWriter", sheet: "AuxiSheet", present: "AuxiPresent", draw: "AuxiDraw", pdf: "AuxiPDF" };

/** Types de documents que l'on peut créer (document vierge). */
export type NewKind = "text" | "spreadsheet" | "presentation" | "drawing";

/** Type de document de chaque application. */
export const APP_DOC: Record<AppKind, NewKind | "pdf" | null> = { office: null, writer: "text", sheet: "spreadsheet", present: "presentation", draw: "drawing", pdf: "pdf" };

/** « Nouveau » : le type de l'application d'abord (Ctrl+N), les autres ensuite (ils ouvrent leur application). */
function newMenu(app: AppKind): MenuEntry {
  const all = [
    { kind: "writer" as const, item: (accel?: string) => a("Document texte", "newText", { accel }) },
    { kind: "sheet" as const, item: (accel?: string) => a("Classeur", "newSheet", { accel }) },
    { kind: "present" as const, item: (accel?: string) => a("Présentation", "newSlides", { accel }) },
    { kind: "draw" as const, item: (accel?: string) => a("Dessin", "newDrawing", { accel }) },
  ];
  const own = all.find((x) => x.kind === app);
  const items: MenuEntry[] = own ? [own.item("CmdOrCtrl+N"), "-", ...all.filter((x) => x !== own).map((x) => x.item())] : all.map((x, i) => x.item(i === 0 ? "CmdOrCtrl+N" : undefined));
  return { submenu: "Nouveau", items };
}

const fileMenu_ = (app: AppKind, type: DocType): MenuDef => ({
  label: "Fichier",
  items: [
    newMenu(app),
    a("Ouvrir…", "open", { accel: "CmdOrCtrl+O" }),
    "-",
    a("Enregistrer", "save", { accel: "CmdOrCtrl+S" }),
    a("Enregistrer sous…", "saveAs", { accel: "CmdOrCtrl+Shift+S" }),
    a("Exporter en PDF…", "exportPdf"),
    ...(type === "drawing" ? [A.exportImage] : []),
    a("Imprimer…", "print", { accel: "CmdOrCtrl+P" }),
    "-",
    A.docProps,
    "-",
    a("Fermer le document", "close", { accel: "CmdOrCtrl+W" }),
  ],
});

/** Menu Fichier sans document ouvert (accueil). */
const homeFileMenu = (app: AppKind): MenuDef => ({
  label: "Fichier",
  items: app === "pdf" ? [a("Ouvrir…", "open", { accel: "CmdOrCtrl+O" })] : [newMenu(app), a("Ouvrir…", "open", { accel: "CmdOrCtrl+O" })],
});

/** Commande du lecteur PDF (traitée par PdfView). */
const p = (label: string, cmd: string, extra: Partial<Action> = {}): Action => ({ label, app: "pdf", args: { cmd }, ...extra });

export const PDF = {
  save: a("Enregistrer", "save", { accel: "CmdOrCtrl+S" }),
  saveAs: a("Enregistrer une copie…", "saveAs", { accel: "CmdOrCtrl+Shift+S" }),
  print: a("Imprimer…", "print", { accel: "CmdOrCtrl+P" }),
  props: p("Propriétés du document…", "properties"),
  close: a("Fermer le document", "close", { accel: "CmdOrCtrl+W" }),
  find: p("Rechercher…", "find", { accel: "CmdOrCtrl+F" }),
  findNext: p("Occurrence suivante", "findNext", { accel: "F3" }),
  findPrev: p("Occurrence précédente", "findPrev", { accel: "Shift+F3" }),
  selectAll: p("Tout sélectionner", "selectAll"),
  copy: p("Copier", "copy"),
  zoomIn: p("Zoom avant", "zoomIn", { accel: "CmdOrCtrl+=" }),
  zoomOut: p("Zoom arrière", "zoomOut", { accel: "CmdOrCtrl+-" }),
  actual: p("Taille réelle", "actual", { accel: "CmdOrCtrl+0" }),
  fitPage: p("Page entière", "fitPage"),
  fitWidth: p("Pleine largeur", "fitWidth"),
  rotateLeft: p("Rotation à gauche", "rotateLeft", { accel: "CmdOrCtrl+Shift+L" }),
  rotateRight: p("Rotation à droite", "rotateRight", { accel: "CmdOrCtrl+Shift+R" }),
  sidebar: p("Panneau latéral", "sidebar", { accel: "F4" }),
  present: p("Mode présentation", "present", { accel: "F5" }),
  scrollVertical: p("Défilement continu", "scrollVertical"),
  scrollPage: p("Une page à la fois", "scrollPage"),
  scrollWrapped: p("Pages en mosaïque", "scrollWrapped"),
  spreadNone: p("Pages seules", "spreadNone"),
  spreadOdd: p("Pages côte à côte (impaires à gauche)", "spreadOdd"),
  spreadEven: p("Pages côte à côte (paires à gauche)", "spreadEven"),
  first: p("Première page", "first", { accel: "CmdOrCtrl+Home" }),
  prev: p("Page précédente", "prev"),
  next: p("Page suivante", "next"),
  last: p("Dernière page", "last", { accel: "CmdOrCtrl+End" }),
  goto: p("Aller à la page…", "goto", { accel: "CmdOrCtrl+G" }),
  noEdit: p("Aucun outil (lecture)", "editNone", { icon: "pointer" }),
  highlight: p("Surligner", "editHighlight", { icon: "highlight" }),
  freeText: p("Texte", "editText", { icon: "textbox" }),
  ink: p("Dessin à main levée", "editInk", { icon: "freehand" }),
  stamp: p("Image…", "editStamp", { icon: "image" }),
  editDraw: p("Modifier dans AuxiDraw", "openInDraw"),
};

function pdfMenus(): MenuDef[] {
  return [
    { label: "Fichier", items: [a("Ouvrir…", "open", { accel: "CmdOrCtrl+O" }), "-", PDF.save, PDF.saveAs, "-", PDF.print, "-", PDF.props, PDF.editDraw, "-", PDF.close] },
    { label: "Édition", items: [PDF.copy, PDF.selectAll, "-", PDF.find, PDF.findNext, PDF.findPrev] },
    {
      label: "Affichage",
      items: [PDF.zoomIn, PDF.zoomOut, PDF.actual, PDF.fitPage, PDF.fitWidth, "-", PDF.rotateLeft, PDF.rotateRight, "-",
        { submenu: "Défilement", items: [PDF.scrollVertical, PDF.scrollPage, PDF.scrollWrapped] },
        { submenu: "Pages côte à côte", items: [PDF.spreadNone, PDF.spreadOdd, PDF.spreadEven] }, "-", PDF.sidebar, PDF.present],
    },
    { label: "Aller", items: [PDF.first, PDF.prev, PDF.next, PDF.last, "-", PDF.goto] },
    { label: "Annoter", items: [PDF.noEdit, "-", PDF.highlight, PDF.freeText, PDF.ink, PDF.stamp] },
  ];
}

const viewItems = (sheet = false): MenuEntry[] => [
  A.zoomIn,
  A.zoomOut,
  A.zoom100,
  ...(sheet ? [] : [A.fitWidth]),
];

export function menusFor(type: DocType | null, app: AppKind = "office"): MenuDef[] {
  if (type === "pdf") return pdfMenus();
  const fileMenu = type ? fileMenu_(app, type) : homeFileMenu(app);
  const editBase: MenuEntry[] = [A.undo, A.redo, "-", A.pasteSpecial, A.selectAll, "-", A.find];
  const language: MenuEntry = {
    submenu: "Langue",
    items: [
      { submenu: "Pour tout le document", items: [A.langDocCa, A.langDocFr, A.langDocEnCa, A.langDocEnUs] },
      { submenu: "Pour le paragraphe", items: [A.langParCa, A.langParFr, A.langParEn] },
    ],
  };
  if (type === "text") {
    return [
      fileMenu,
      {
        label: "Édition",
        items: [...editBase, A.gotoPage, "-",
          { submenu: "Suivi des modifications", items: [A.trackChanges, A.showChanges, "-", A.nextChange, A.acceptAll, A.rejectAll, "-", A.manageChanges] },
          A.deleteComments],
      },
      { label: "Affichage", items: [...viewItems(), "-", A.formattingMarks, A.textBoundaries, A.fieldShadings] },
      {
        label: "Insertion",
        items: [A.pageBreak, A.otherBreak, A.titlePage, "-", A.table, A.image, A.chart, A.textFrame, A.formula, A.fontwork, A.qrCode, "-",
          A.specialChar, A.hyperlink, A.bookmark, A.crossRef, A.comment, "-", A.footnote, A.endnote,
          { submenu: "Champ", items: [A.pageNumber, A.dateField, A.field] }, "-",
          { submenu: "Table des matières et index", items: [A.toc, A.indexEntry] }, A.section, A.envelope],
      },
      {
        label: "Format",
        items: [A.fontDialog, A.paragraphDialog, A.bullets, A.columns, A.pageStyle, "-",
          { submenu: "Texte", items: [A.bold, A.italic, A.underline, A.strike, "-", A.superscript, A.subscript, "-", A.upper, A.lower, "-", A.grow, A.shrink] },
          { submenu: "Interligne", items: [A.spacing1, A.spacing15, A.spacing2] },
          A.indentMore, A.indentLess, "-", A.cloneFormat, A.clearFormat, "-",
          { submenu: "Styles", items: [A.editStyle, A.newStyle] }, A.theme],
      },
      {
        label: "Tableau",
        items: [A.table, A.textToTable, "-", A.tableRowsAbove, A.tableRowsBelow, A.tableColsBefore, A.tableColsAfter, "-", A.deleteRows, A.deleteCols, A.deleteTable, "-", A.mergeCells, A.splitCells, "-", A.sortText, A.tableProps],
      },
      {
        label: "Outils",
        items: [{ submenu: "AuxiCorrect", items: [A.acCheck, A.acDictionary, "-", A.acOptions] }, "-", A.spelling, A.autoSpell, A.thesaurus, language, A.hyphenate, A.wordCount, "-", A.autoText, A.lineNumbering, A.footnoteSettings, A.chapterNumbering, "-", A.updateAll],
      },
    ];
  }
  if (type === "spreadsheet") {
    return [
      fileMenu,
      { label: "Édition", items: [...editBase, "-", A.fillDown, A.fillSeries, "-", A.deleteContents, A.deleteCells, "-", { submenu: "Suivi des modifications", items: [A.calcTrack, A.calcManageChanges] }] },
      { label: "Affichage", items: [...viewItems(true), "-", A.freeze] },
      {
        label: "Insertion",
        items: [A.insertCells, A.rowsAbove, A.rowsBelow, A.colsBefore, A.colsAfter, "-", A.functionWizard, A.autoSum, A.currentDate, A.currentTime, "-",
          A.chart, A.sparkline, A.pivot, A.image, A.qrCode, "-", A.specialChar, A.hyperlink, A.comment],
      },
      {
        label: "Format",
        items: [A.cellFormat, "-",
          { submenu: "Nombre", items: [A.numDecimal, A.currency, A.percent, A.dateFormat, A.numTime, A.numScientific, "-", A.incDecimals, A.decDecimals] },
          { submenu: "Formatage conditionnel", items: [A.condFormat, A.colorScale, A.dataBar, A.iconSet, "-", A.manageCond] },
          A.merge, A.wrap, A.autoFormatCells, "-",
          { submenu: "Lignes", items: [A.rowHeight, A.optimalHeight, A.hideRows, A.showRows] },
          { submenu: "Colonnes", items: [A.colWidth, A.optimalWidth, A.hideCols, A.showCols] }, "-",
          A.fontDialog, A.clearFormat, A.calcPage,
          { submenu: "Zones d'impression", items: [A.printAreaDefine, A.printAreaDelete, A.printAreaEdit] }],
      },
      { label: "Feuille", items: [A.sheetInsert, A.sheetDelete, A.sheetRename, A.sheetMove, "-", A.sheetHide, A.sheetShow, A.sheetColor, "-", A.deleteRows, A.deleteCols] },
      {
        label: "Données",
        items: [A.sort, A.sortAsc, A.sortDesc, "-", A.autoFilter, A.stdFilter, A.specialFilter, A.removeFilter, "-", A.subtotals, A.pivot, A.consolidate, A.textToColumns, "-",
          { submenu: "Plan", items: [A.group, A.ungroup] }, A.validity, A.dbRange, A.dataForm, A.names, "-",
          { submenu: "Statistiques", items: [A.randomNumbers, A.descStats] }, "-", A.recalc, A.recalcHard],
      },
      {
        label: "Outils",
        items: [{ submenu: "AuxiCorrect", items: [A.acDictionary, A.acOptions] }, "-", A.calcSpell, language, "-", A.goalSeek, "-", { submenu: "Audit", items: [A.showPrecedents, A.showDependents, A.clearArrows] }, "-", A.sheetProtect, A.bookProtect],
      },
    ];
  }
  if (type === "drawing") {
    return [
      fileMenu,
      { label: "Édition", items: [...editBase, "-", A.dupPage, A.delPage] },
      { label: "Affichage", items: [...viewItems(), "-", A.grid, A.snapGrid, A.helplines] },
      {
        label: "Insertion",
        items: [A.newPage, A.dupPage, "-", A.image, A.textBox, A.table, A.chart, A.qrCode, A.fontwork, "-",
          { submenu: "Formes", items: [A.shapeRect, A.shapeRoundRect, A.shapeEllipse, A.shapeTriangle, A.shapeStar, A.shapeCallout, "-", A.shapeFlow, A.shapeDecision, A.shapeArrow] },
          { submenu: "Lignes", items: [A.shapeLine, A.lineArrow, A.connector, A.curve, A.polygon, A.freeline, A.measure] }, "-",
          A.specialChar, A.hyperlink, A.comment, { submenu: "Champ", items: [A.slideNumber, A.slideDate] }, "-", A.layer],
      },
      {
        label: "Format",
        items: [A.fontDialog, A.paragraphDialog, A.outlineBullets, A.textAttrs, "-", A.area, A.line, A.shadow, A.transform, "-",
          { submenu: "Convertir", items: [A.convertCurve, A.convertPolygon] }, "-", A.bold, A.italic, A.underline, A.strike, "-", A.clearFormat],
      },
      {
        label: "Disposition",
        items: [{ submenu: "Disposition", items: [A.toFront, A.forward, A.backward, A.toBack] },
          { submenu: "Aligner", items: [A.alignLeft, A.alignHCenter, A.alignRight, "-", A.alignTop, A.alignVCenter, A.alignBottom] },
          A.distribute, "-", A.flipH, A.flipV, A.rotate, "-", A.groupShapes, A.ungroupShapes, A.enterGroup, A.leaveGroup, "-",
          { submenu: "Formes", items: [A.combine, A.merge2, A.subtract, A.intersect] }],
      },
      { label: "Page", items: [A.newPage, A.dupPage, A.delPage, A.renamePage, "-", A.pageProps, A.layer] },
      { label: "Outils", items: [{ submenu: "AuxiCorrect", items: [A.acDictionary, A.acOptions] }, "-", A.calcSpell, language] },
    ];
  }
  if (type === "presentation") {
    return [
      fileMenu,
      { label: "Édition", items: editBase },
      { label: "Affichage", items: viewItems() },
      {
        label: "Insertion",
        items: [A.newSlide, A.dupSlide, "-", A.textBox, A.image, A.table, A.chart, A.qrCode, A.fontwork, "-",
          { submenu: "Formes", items: [A.shapeRect, A.shapeEllipse, A.shapeArrow, A.shapeLine] }, "-",
          A.specialChar, A.hyperlink, A.comment, { submenu: "Champ", items: [A.slideNumber, A.slideDate] }, A.headerFooter],
      },
      {
        label: "Format",
        items: [A.fontDialog, A.paragraphDialog, A.outlineBullets, A.textAttrs, "-", A.area, A.line, A.transform, "-",
          { submenu: "Disposition", items: [A.toFront, A.toBack] }, "-", A.bold, A.italic, A.underline, A.strike, "-", A.clearFormat],
      },
      {
        label: "Diapositive",
        items: [A.newSlide, A.dupSlide, A.delSlide, A.renameSlide, "-", A.hideSlide, A.showSlide, "-",
          { submenu: "Mise en page", items: [A.layoutTitle, A.layoutContent, A.layoutTwo, A.layoutTitleOnly, A.layoutBlank] }, A.slideProps, A.masters],
      },
      { label: "Diaporama", items: [A.slideShow, A.slideShowHere] },
      { label: "Outils", items: [{ submenu: "AuxiCorrect", items: [A.acDictionary, A.acOptions] }, "-", A.calcSpell, language] },
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
  if (type === "drawing") {
    return [
      { label: "Accueil", home: true, groups: [] },
      {
        label: "Insertion",
        groups: [
          { label: "Pages", actions: [A.newPage, A.dupPage] },
          { label: "Objets", actions: [A.image, A.textBox, A.table, A.chart] },
          { label: "Formes", actions: [A.shapeRect, A.shapeRoundRect, A.shapeEllipse, A.shapeTriangle, A.shapeStar, A.shapeCallout, A.shapeDecision, A.shapeArrow] },
          { label: "Lignes", actions: [A.shapeLine, A.lineArrow, A.connector, A.curve, A.polygon, A.freeline, A.measure] },
        ],
      },
      {
        label: "Disposition",
        groups: [
          { label: "Plan", actions: [A.toFront, A.toBack] },
          { label: "Aligner", actions: [A.alignLeft, A.alignHCenter, A.alignRight, A.alignTop, A.alignVCenter, A.alignBottom] },
          { label: "Transformer", actions: [A.flipH, A.flipV, A.rotate, A.transform] },
          { label: "Grouper", actions: [A.groupShapes, A.ungroupShapes] },
        ],
      },
      { label: "Format", groups: [{ label: "Objet", actions: [A.area, A.line, A.transform] }, { label: "Texte", actions: [A.fontDialog, A.paragraphDialog] }] },
      { label: "Page", groups: [{ label: "Page", actions: [A.newPage, A.dupPage, A.delPage, A.pageProps, A.layer] }, { label: "Exporter", actions: [A.exportImage, A.print] }] },
      { label: "Affichage", groups: [{ label: "Zoom", actions: [A.zoomOut, A.zoomIn, A.fitWidth] }, { label: "Grille", actions: [A.grid] }] },
    ];
  }
  if (type === "text") {
    return [
      { label: "Accueil", home: true, groups: [] },
      {
        label: "Insertion",
        groups: [
          { label: "Pages", actions: [A.pageBreak, A.section] },
          { label: "Objets", actions: [A.table, A.image, A.chart, A.textFrame, A.formula] },
          { label: "Symboles", actions: [A.specialChar, A.qrCode] },
          { label: "Liens", actions: [A.hyperlink, A.bookmark, A.comment] },
          { label: "Notes et champs", actions: [A.footnote, A.pageNumber, A.field, A.toc] },
        ],
      },
      {
        label: "Mise en page",
        groups: [
          { label: "Page", actions: [A.pageStyle, A.columns, A.pageBreak] },
          { label: "Paragraphe", actions: [A.paragraphDialog, A.bullets, A.indentLess, A.indentMore] },
          { label: "Caractère", actions: [A.fontDialog, A.cloneFormat, A.clearFormat] },
          { label: "Imprimer", actions: [A.print] },
        ],
      },
      {
        label: "Révision",
        groups: [
          { label: "AuxiCorrect", actions: [A.acCheck, A.acDictionary, A.acOptions] },
          { label: "Vérification", actions: [A.thesaurus, A.wordCount] },
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
          { label: "Objets", actions: [A.chart, A.pivot, A.image, A.hyperlink, A.comment] },
        ],
      },
      {
        label: "Mise en forme",
        groups: [
          { label: "Cellules", actions: [A.cellFormat, A.condFormat, A.merge, A.wrap] },
          { label: "Nombre", actions: [A.currency, A.percent] },
          { label: "Page", actions: [A.calcPage, A.printAreaDefine, A.print] },
        ],
      },
      {
        label: "Données",
        groups: [
          { label: "Trier et filtrer", actions: [A.sort, A.autoFilter] },
          { label: "Analyse", actions: [A.subtotals, A.pivot, A.goalSeek] },
          { label: "Outils", actions: [A.validity, A.freeze] },
        ],
      },
      { label: "Révision", groups: [{ label: "Vérification", actions: [A.calcSpell, A.comment] }, { label: "Suivi", actions: [A.calcTrack, A.calcManageChanges] }, { label: "Protection", actions: [A.sheetProtect] }] },
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
        { label: "Formes", actions: [A.shapeRect, A.shapeEllipse, A.shapeArrow, A.shapeLine] },
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
    { label: "Diaporama", groups: [{ label: "Présenter", actions: [A.slideShow, A.slideShowHere] }] },
    { label: "Affichage", groups: [{ label: "Zoom", actions: [A.zoomOut, A.zoomIn, A.fitWidth] }] },
  ];
}
