// Coloration minimale des Makefile (les modes de CodeMirror n'en ont pas) :
// commentaires, cibles, affectations, variables $(…) et ${…}, directives,
// lignes de recette (commençant par une tabulation).

import type { StreamParser } from "@codemirror/language";

interface State {
  recipe: boolean;
}

const DIRECTIVES = /^(?:ifeq|ifneq|ifdef|ifndef|else|endif|include|-include|sinclude|override|export|unexport|define|endef|vpath|undefine|private)\b/;

export const makefile: StreamParser<State> = {
  name: "makefile",
  startState: () => ({ recipe: false }),
  token(stream, state) {
    if (stream.sol()) state.recipe = stream.peek() === "\t";
    if (stream.eatSpace()) return null;
    const ch = stream.peek();
    if (ch === "#") {
      stream.skipToEnd();
      return "comment";
    }
    if (ch === "$") {
      stream.next();
      if (stream.eat("(") || stream.eat("{")) {
        let depth = 1;
        while (depth > 0 && !stream.eol()) {
          const c = stream.next();
          if (c === "(" || c === "{") depth++;
          else if (c === ")" || c === "}") depth--;
        }
      } else {
        stream.next();
      }
      return "variableName.special";
    }
    if (state.recipe) {
      if (ch === "@" || ch === "-") {
        stream.next();
        return "operator";
      }
      if (ch === '"' || ch === "'") {
        const q = stream.next();
        while (!stream.eol() && stream.next() !== q) {
          /* chaîne */
        }
        return "string";
      }
      stream.next();
      return null;
    }
    if (stream.sol() || stream.column() === stream.indentation()) {
      if (stream.match(DIRECTIVES)) return "keyword";
      // Cible : « nom : » ; affectation : « NOM = », « := », « ?= », « += ».
      if (stream.match(/^[^\s:=#?+!]+(?=\s*(?::=|::=|\?=|\+=|!=|=))/)) return "variableName.definition";
      if (stream.match(/^[^:=#]+(?=\s*::?(?!=))/)) return "labelName";
    }
    if (stream.match(/^(?::=|::=|\?=|\+=|!=|=|::?)/)) return "operator";
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "#" } },
};
