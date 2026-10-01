/*
 * AuxiText — éditeur de texte brut d'AuxiNux Office
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

#include "textio.h"

#include <QTextCodec>

namespace TextIO {

static const char* codecName(Encoding e)
{
    switch (e) {
    case Encoding::Utf8:
    case Encoding::Utf8Bom:     return "UTF-8";
    case Encoding::Utf16LE:     return "UTF-16LE";
    case Encoding::Utf16BE:     return "UTF-16BE";
    case Encoding::Latin1:      return "ISO-8859-1";
    case Encoding::Windows1252: return "windows-1252";
    }
    return "UTF-8";
}

Eol platformEol()
{
#ifdef Q_OS_WIN
    return Eol::CRLF;
#else
    return Eol::LF;
#endif
}

EolStats countEols(const QString& text)
{
    EolStats s;
    const int n = text.size();
    const QChar* d = text.constData();
    for (int i = 0; i < n; ++i) {
        if (d[i] == QLatin1Char('\r')) {
            if (i + 1 < n && d[i + 1] == QLatin1Char('\n')) {
                ++s.crlf;
                ++i;
            } else {
                ++s.cr;
            }
        } else if (d[i] == QLatin1Char('\n')) {
            ++s.lf;
        }
    }
    return s;
}

Eol dominantEol(const EolStats& s, Eol fallback)
{
    if (s.lf == 0 && s.crlf == 0 && s.cr == 0)
        return fallback;
    if (s.crlf >= s.lf && s.crlf >= s.cr)
        return s.crlf == s.lf && fallback == Eol::LF ? Eol::LF : Eol::CRLF;
    if (s.lf >= s.cr)
        return Eol::LF;
    return Eol::CR;
}

static QString normalizeEols(QString text)
{
    text.replace(QLatin1String("\r\n"), QLatin1String("\n"));
    text.replace(QLatin1Char('\r'), QLatin1Char('\n'));
    return text;
}

Document decode(const QByteArray& raw)
{
    Document doc;
    QByteArray body = raw;
    QTextCodec* codec = nullptr;

    if (raw.startsWith("\xEF\xBB\xBF")) {
        doc.encoding = Encoding::Utf8Bom;
        body = raw.mid(3);
    } else if (raw.startsWith("\xFF\xFE")) {
        doc.encoding = Encoding::Utf16LE;
        body = raw.mid(2);
    } else if (raw.startsWith("\xFE\xFF")) {
        doc.encoding = Encoding::Utf16BE;
        body = raw.mid(2);
    } else {
        // Sans BOM : UTF-8 strict, sinon repli sur un encodage 8 bits.
        QTextCodec* utf8 = QTextCodec::codecForName("UTF-8");
        QTextCodec::ConverterState state;
        const QString probe = utf8->toUnicode(raw.constData(), raw.size(), &state);
        if (state.invalidChars == 0 && state.remainingChars == 0) {
            doc.encoding = Encoding::Utf8;
            doc.text = probe;
        } else {
            doc.encoding = Encoding::Windows1252;
            doc.hadInvalidUtf8 = true;
        }
    }

    if (doc.text.isNull()) {
        codec = QTextCodec::codecForName(codecName(doc.encoding));
        QTextCodec::ConverterState state(QTextCodec::IgnoreHeader);
        doc.text = codec->toUnicode(body.constData(), body.size(), &state);
    }

    doc.eolStats = countEols(doc.text);
    doc.eol = dominantEol(doc.eolStats, platformEol());
    doc.text = normalizeEols(doc.text);
    doc.endsWithNewline = doc.text.endsWith(QLatin1Char('\n'));
    if (doc.text.isNull())
        doc.text = QStringLiteral("");
    return doc;
}

QByteArray encode(const QString& text, Encoding encoding, Eol eol)
{
    QString out = normalizeEols(text);
    if (eol == Eol::CRLF)
        out.replace(QLatin1Char('\n'), QLatin1String("\r\n"));
    else if (eol == Eol::CR)
        out.replace(QLatin1Char('\n'), QLatin1Char('\r'));

    QTextCodec* codec = QTextCodec::codecForName(codecName(encoding));
    QTextCodec::ConverterState state(QTextCodec::IgnoreHeader);
    QByteArray bytes = codec->fromUnicode(out.constData(), out.size(), &state);

    switch (encoding) {
    case Encoding::Utf8Bom: return QByteArray("\xEF\xBB\xBF") + bytes;
    case Encoding::Utf16LE: return QByteArray("\xFF\xFE") + bytes;
    case Encoding::Utf16BE: return QByteArray("\xFE\xFF") + bytes;
    default:                return bytes;
    }
}

bool canEncodeLosslessly(const QString& text, Encoding encoding)
{
    switch (encoding) {
    case Encoding::Utf8:
    case Encoding::Utf8Bom:
    case Encoding::Utf16LE:
    case Encoding::Utf16BE:
        return true;
    default:
        return QTextCodec::codecForName(codecName(encoding))->canEncode(text);
    }
}

QString eolName(Eol eol)
{
    switch (eol) {
    case Eol::LF:   return QStringLiteral("LF");
    case Eol::CRLF: return QStringLiteral("CRLF");
    case Eol::CR:   return QStringLiteral("CR");
    }
    return QString();
}

QString encodingName(Encoding encoding)
{
    switch (encoding) {
    case Encoding::Utf8:        return QStringLiteral("UTF-8");
    case Encoding::Utf8Bom:     return QStringLiteral("UTF-8 BOM");
    case Encoding::Utf16LE:     return QStringLiteral("UTF-16 LE");
    case Encoding::Utf16BE:     return QStringLiteral("UTF-16 BE");
    case Encoding::Latin1:      return QStringLiteral("ISO-8859-1");
    case Encoding::Windows1252: return QStringLiteral("Windows-1252");
    }
    return QString();
}

}
