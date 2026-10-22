// Zone d'édition : CodeMirror 6, un EditorView par onglet. Les réglages qui
// changent en cours de route (langage, thème, police, retour à la ligne,
// indentation…) sont dans des compartiments reconfigurables.

import { Compartment, EditorSelection, EditorState, type Extension, type Text } from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightTrailingWhitespace,
  highlightWhitespace,
  keymap,
  lineNumbers,
  rectangularSelection,
  type KeyBinding,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { language } from "./languages";
import { effectiveFontSize, fontStack, type Prefs } from "./prefs";
import type { Indent } from "./util";

/** Traductions des textes de CodeMirror (recherche, aller à la ligne…). */
export const PHRASES: Record<string, string> = {
  Find: "Rechercher",
  Replace: "Remplacer",
  next: "suivant",
  previous: "précédent",
  all: "tout",
  "match case": "respecter la casse",
  "by word": "mot entier",
  regexp: "expression régulière",
  replace: "remplacer",
  "replace all": "tout remplacer",
  close: "fermer",
  "current match": "occurrence actuelle",
  "replaced $ matches": "$ occurrences remplacées",
  "replaced match on line $": "occurrence remplacée à la ligne $",
  "on line": "à la ligne",
  "Go to line": "Aller à la ligne",
  go: "aller",
  "Control character": "Caractère de contrôle",
  "Folded lines": "Lignes repliées",
  "Unfolded lines": "Lignes dépliées",
  "folded code": "code replié",
  unfold: "déplier",
  "Fold line": "Replier",
  "Unfold line": "Déplier",
  "Selection deleted": "Sélection supprimée",
  to: "à",
};

const languageC = new Compartment();
const themeC = new Compartment();
const fontC = new Compartment();
const wrapC = new Compartment();
const gutterC = new Compartment();
const activeLineC = new Compartment();
const whitespaceC = new Compartment();
const indentC = new Compartment();

const lightTheme = EditorView.theme(
  {
    "&": { backgroundColor: "var(--editor-bg)", color: "var(--editor-fg)" },
    ".cm-gutters": { backgroundColor: "var(--gutter-bg)", color: "var(--gutter-fg)", borderRight: "1px solid var(--border)" },
    ".cm-activeLine": { backgroundColor: "var(--active-line)" },
    ".cm-activeLineGutter": { backgroundColor: "var(--active-line)" },
  },
  { dark: false },
);

const darkTheme = [
  oneDark,
  EditorView.theme(
    {
      ".cm-gutters": { borderRight: "1px solid var(--border)" },
    },
    { dark: true },
  ),
];

function themeExt(dark: boolean): Extension {
  return dark ? darkTheme : [lightTheme, syntaxHighlighting(defaultHighlightStyle, { fallback: true })];
}

function fontExt(p: Prefs): Extension {
  const size = `${effectiveFontSize(p)}px`;
  const family = fontStack(p);
  return EditorView.theme({
    "&": { fontSize: size },
    ".cm-content, .cm-gutters, .cm-search input": { fontFamily: family },
    ".cm-scroller": { fontFamily: family, lineHeight: "1.45" },
  });
}

function indentExt(indent: Indent): Extension {
  const width = indent.width || 4;
  return [EditorState.tabSize.of(width), indentUnit.of(indent.tabs ? "\t" : " ".repeat(width))];
}

export interface EditorOptions {
  prefs: Prefs;
  dark: boolean;
  indent: Indent;
  /** Raccourcis de l'application (prioritaires sur ceux de CodeMirror). */
  keys: KeyBinding[];
  onUpdate: (view: EditorView, docChanged: boolean) => void;
}

export function createEditor(parent: HTMLElement, text: string, o: EditorOptions): EditorView {
  const p = o.prefs;
  const state = EditorState.create({
    doc: text,
    extensions: [
      EditorState.phrases.of(PHRASES),
      keymap.of(o.keys),
      gutterC.of(p.lineNumbers ? [lineNumbers(), foldGutter()] : []),
      activeLineC.of(p.highlightLine ? [highlightActiveLine(), highlightActiveLineGutter()] : []),
      whitespaceC.of(p.showWhitespace ? [highlightWhitespace(), highlightTrailingWhitespace()] : []),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      rectangularSelection(),
      crosshairCursor(),
      highlightSelectionMatches(),
      search({ top: true }),
      keymap.of([...searchKeymap, ...historyKeymap, ...foldKeymap, ...defaultKeymap, indentWithTab]),
      languageC.of([]),
      themeC.of(themeExt(o.dark)),
      fontC.of(fontExt(p)),
      wrapC.of(p.wrap ? EditorView.lineWrapping : []),
      indentC.of(indentExt(o.indent)),
      EditorView.updateListener.of((u) => {
        if (u.docChanged || u.selectionSet || u.focusChanged) o.onUpdate(u.view, u.docChanged);
      }),
      EditorView.contentAttributes.of({ spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
    ],
  });
  return new EditorView({ state, parent });
}

/** Applique les préférences (police, zoom, affichage) à un éditeur. */
export function applyPrefs(view: EditorView, p: Prefs, dark: boolean) {
  view.dispatch({
    effects: [
      themeC.reconfigure(themeExt(dark)),
      fontC.reconfigure(fontExt(p)),
      wrapC.reconfigure(p.wrap ? EditorView.lineWrapping : []),
      gutterC.reconfigure(p.lineNumbers ? [lineNumbers(), foldGutter()] : []),
      activeLineC.reconfigure(p.highlightLine ? [highlightActiveLine(), highlightActiveLineGutter()] : []),
      whitespaceC.reconfigure(p.showWhitespace ? [highlightWhitespace(), highlightTrailingWhitespace()] : []),
    ],
  });
}

export function setIndent(view: EditorView, indent: Indent) {
  view.dispatch({ effects: indentC.reconfigure(indentExt(indent)) });
}

/** Charge la coloration du langage (à la demande) puis l'applique. */
export async function setLanguage(view: EditorView, id: string): Promise<void> {
  const def = language(id);
  let ext: Extension = [];
  if (def.load) {
    try {
      ext = await def.load();
    } catch (e) {
      console.warn("langage", id, e);
    }
  }
  view.dispatch({ effects: languageC.reconfigure(ext) });
}

/**
 * Remplace tout le contenu (rechargement, autre encodage) : l'historique
 * d'annulation est conservé, le curseur reste à la même ligne si possible.
 */
export function replaceContent(view: EditorView, text: string) {
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.head);
  const col = sel.head - line.from;
  const top = view.scrollDOM.scrollTop;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  const doc = view.state.doc;
  const l = doc.line(Math.min(line.number, doc.lines));
  view.dispatch({ selection: EditorSelection.cursor(Math.min(l.from + col, l.to)) });
  view.scrollDOM.scrollTop = top;
}

/** Vrai si le contenu est identique à `saved` (rapide quand la longueur diffère). */
export function sameDoc(doc: Text, saved: Text): boolean {
  return doc === saved || (doc.length === saved.length && doc.eq(saved));
}
