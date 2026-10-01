/*
 * AuxiText — éditeur de texte brut d'AuxiNux Office
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Lecture/écriture de fichiers texte : détection de l'encodage (BOM, UTF-8
 * strict, repli 8 bits) et des fins de ligne (LF, CRLF, CR, mixte).
 * Aucune dépendance aux widgets : testé par tests/auxitext.
 */

#ifndef AUXITEXT_TEXTIO_H
#define AUXITEXT_TEXTIO_H

#include <QByteArray>
#include <QString>

namespace TextIO {

enum class Eol { LF, CRLF, CR };

enum class Encoding {
    Utf8,        // UTF-8 sans BOM (par défaut)
    Utf8Bom,     // UTF-8 avec BOM
    Utf16LE,     // UTF-16 little endian avec BOM
    Utf16BE,     // UTF-16 big endian avec BOM
    Latin1,      // ISO-8859-1
    Windows1252  // CP1252 (repli 8 bits par défaut)
};

struct EolStats {
    int lf = 0;
    int crlf = 0;
    int cr = 0;
    bool mixed() const { return (lf > 0) + (crlf > 0) + (cr > 0) > 1; }
};

struct Document {
    QString text;                 // contenu normalisé avec '\n'
    Encoding encoding = Encoding::Utf8;
    Eol eol = Eol::LF;
    EolStats eolStats;
    bool hadInvalidUtf8 = false;  // décodé avec un encodage 8 bits de repli
    bool endsWithNewline = false;
};

// Fin de ligne native de la plateforme (CRLF sous Windows, LF ailleurs).
Eol platformEol();

EolStats countEols(const QString& text);
Eol dominantEol(const EolStats& stats, Eol fallback);

// Décode des octets bruts (détection d'encodage + fins de ligne).
Document decode(const QByteArray& raw);

// Encode le texte (normalisé '\n') avec l'encodage et la fin de ligne choisis.
QByteArray encode(const QString& text, Encoding encoding, Eol eol);

// Indique si l'encodage peut représenter tout le texte sans perte.
bool canEncodeLosslessly(const QString& text, Encoding encoding);

QString eolName(Eol eol);
QString encodingName(Encoding encoding);

}

#endif // AUXITEXT_TEXTIO_H
