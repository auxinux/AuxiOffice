// Journaux (.log, syslog…) : niveaux de gravité, dates et heures, adresses,
// chaînes entre guillemets.

import type { StreamParser } from "@codemirror/language";

const ERROR = /^(?:FATAL|CRITICAL|CRIT|EMERG(?:ENCY)?|ALERT|ERROR|ERR|FAIL(?:ED|URE)?|PANIC|SEVERE|erreur|échec|Erreur|Échec)\b/;
const WARN = /^(?:WARN(?:ING)?|AVERTISSEMENT|Avertissement|attention|Attention|NOTICE|DEPRECATED)\b/;
const INFO = /^(?:INFO|INFORMATION|OK|SUCCESS|DONE)\b/;
const DEBUG = /^(?:DEBUG|DBG|TRACE|VERBOSE|FINE|FINER|FINEST)\b/;

export const logfile: StreamParser<null> = {
  name: "log",
  startState: () => null,
  token(stream) {
    if (stream.eatSpace()) return null;
    // 2026-10-22T12:34:56.789Z, 22/10/2026, 12:34:56,789
    if (stream.match(/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?/)) return "number";
    if (stream.match(/^\d{1,2}[/.]\d{1,2}[/.]\d{2,4}/)) return "number";
    if (stream.match(/^\d{2}:\d{2}:\d{2}(?:[.,]\d+)?/)) return "number";
    // Oct 22 12:34:56 (syslog)
    if (stream.sol() && stream.match(/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\b/)) return "number";
    if (stream.match(/^\[\s*\d+\.\d+\]/)) return "number"; // dmesg
    if (stream.match(ERROR)) return "invalid";
    if (stream.match(WARN)) return "keyword";
    if (stream.match(INFO)) return "atom";
    if (stream.match(DEBUG)) return "comment";
    if (stream.match(/^(?:https?|file|ftp):\/\/\S+/)) return "link";
    if (stream.match(/^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/)) return "number";
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return "string";
    if (stream.match(/^0x[0-9a-fA-F]+\b/)) return "number";
    stream.next();
    stream.eatWhile(/[\wÀ-ɏ]/);
    return null;
  },
};
