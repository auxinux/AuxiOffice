// Correction du français par AuxiCorrect (facultative) : soulignements,
// message et suggestions au survol (linter de CodeMirror). La coque appelle
// `auxicorrect-cli` (lib.rs) ; une réponse arrivée après une nouvelle frappe
// est ignorée par CodeMirror. Texte brut et Markdown seulement.

import { forEachDiagnostic, linter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { api, type Remark } from "./api";

/** Langages vérifiés (le code source et les fichiers de configuration ne le sont pas). */
export const SPELL_LANGUAGES = ["plain", "markdown"];

/** Au-delà, pas de vérification (le moteur est relancé à chaque appel). */
export const SPELL_MAX_CHARS = 200_000;

/** Pause de frappe avant une vérification (ms). */
const DELAY = 900;

/** Remarques ignorées pendant la session (règle + texte visé). */
const ignored = new Set<string>();

const ignoreKey = (rule: string, text: string) => `${rule}\u0000${text}`;

/**
 * Couleur du soulignement : rouge pour l'orthographe, bleu pour la grammaire,
 * orange pour la typographie, le style et les particularités régionales.
 */
export function severityFor(category: string): Diagnostic["severity"] {
  if (category === "Spelling") return "error";
  if (category === "Grammar") return "hint"; // bleu (« info » serait gris)
  return "warning";
}

const CATEGORY_LABELS: Record<string, string> = {
  Spelling: "Orthographe",
  Grammar: "Grammaire",
  Typography: "Typographie",
  Style: "Style",
  Regional: "Particularité régionale",
};

/** Remarques d'AuxiCorrect → diagnostics de CodeMirror. */
export function toDiagnostics(remarks: Remark[], docText: string, ignore: Set<string> = ignored): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const r of remarks) {
    if (r.to <= r.from || r.to > docText.length) continue;
    const text = docText.slice(r.from, r.to);
    if (ignore.has(ignoreKey(r.rule, text))) continue;
    const label = CATEGORY_LABELS[r.category];
    out.push({
      from: r.from,
      to: r.to,
      severity: severityFor(r.category),
      source: label ? `AuxiCorrect · ${label}` : "AuxiCorrect",
      message: r.message || "Remarque d'AuxiCorrect",
      actions: [
        ...r.suggestions.slice(0, 5).map((s) => ({
          name: s,
          apply: (view: EditorView, from: number, to: number) => view.dispatch({ changes: { from, to, insert: s } }),
        })),
        {
          name: "Ignorer",
          apply: (view: EditorView) => {
            ignore.add(ignoreKey(r.rule, text));
            // Retirer tout de suite les remarques identiques (même message, même texte).
            const keep: Diagnostic[] = [];
            forEachDiagnostic(view.state, (d, from, to) => {
              if (!(d.message === r.message && view.state.sliceDoc(from, to) === text)) keep.push({ ...d, from, to });
            });
            view.dispatch(setDiagnostics(view.state, keep));
          },
        },
      ],
    });
  }
  return out;
}

/** Extension de correction ; `onError` reçoit un échec d'AuxiCorrect (une fois par série). */
export function spellExtension(international: boolean, onError: (message: string) => void): Extension {
  let failed = false;
  return linter(
    async (view) => {
      const text = view.state.doc.toString();
      if (!text.trim() || text.length > SPELL_MAX_CHARS) return [];
      try {
        const remarks = await api.auxicorrectCheck(text, international);
        failed = false;
        return toDiagnostics(remarks, text);
      } catch (e) {
        if (!failed) onError(String(e));
        failed = true;
        return [];
      }
    },
    { delay: DELAY },
  );
}

/** Vrai si ce document doit être vérifié. */
export function shouldSpell(lang: string, enabled: boolean, length: number): boolean {
  return enabled && SPELL_LANGUAGES.includes(lang) && length <= SPELL_MAX_CHARS;
}

/** Traductions des textes du linter de CodeMirror. */
export const LINT_PHRASES: Record<string, string> = {
  Diagnostics: "Remarques",
  "No diagnostics": "Aucune remarque",
};
