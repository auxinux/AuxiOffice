/*
 * AuxiText — éditeur de texte brut d'AuxiNux Office
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

#include "highlighter.h"

#include <QColor>
#include <QFileInfo>
#include <QFont>

namespace {
enum BlockState { Normal = 0, InXmlComment = 1, InMarkdownFence = 2 };

QTextCharFormat fmt(const QColor& color, bool bold = false, bool italic = false)
{
    QTextCharFormat f;
    f.setForeground(color);
    if (bold)
        f.setFontWeight(QFont::Bold);
    f.setFontItalic(italic);
    return f;
}
}

Highlighter::Highlighter(QTextDocument* parent)
    : QSyntaxHighlighter(parent)
{
    setDarkPalette(false);
}

Highlighter::Language Highlighter::languageForFile(const QString& fileName)
{
    const QString suffix = QFileInfo(fileName).suffix().toLower();
    if (suffix == QLatin1String("json"))
        return Language::Json;
    if (suffix == QLatin1String("xml") || suffix == QLatin1String("svg") || suffix == QLatin1String("xsd")
        || suffix == QLatin1String("xsl") || suffix == QLatin1String("xslt"))
        return Language::Xml;
    if (suffix == QLatin1String("yaml") || suffix == QLatin1String("yml"))
        return Language::Yaml;
    if (suffix == QLatin1String("md") || suffix == QLatin1String("markdown"))
        return Language::Markdown;
    if (suffix == QLatin1String("ini") || suffix == QLatin1String("conf") || suffix == QLatin1String("cfg")
        || suffix == QLatin1String("desktop") || suffix == QLatin1String("properties"))
        return Language::Ini;
    return Language::None;
}

QString Highlighter::languageName(Language language)
{
    switch (language) {
    case Language::Json:     return QStringLiteral("JSON");
    case Language::Xml:      return QStringLiteral("XML");
    case Language::Yaml:     return QStringLiteral("YAML");
    case Language::Markdown: return QStringLiteral("Markdown");
    case Language::Ini:      return QStringLiteral("INI");
    case Language::None:     break;
    }
    return tr("Plain text");
}

void Highlighter::setLanguage(Language language)
{
    if (m_language == language)
        return;
    m_language = language;
    rebuildRules();
    rehighlight();
}

void Highlighter::setDarkPalette(bool dark)
{
    m_dark = dark;
    const bool d = dark;
    m_comment   = fmt(QColor(d ? "#8B949E" : "#6E7781"), false, true);
    m_keyword   = fmt(QColor(d ? "#D2A8FF" : "#8250DF"), true);
    m_string    = fmt(QColor(d ? "#7EE787" : "#0A7A33"));
    m_number    = fmt(QColor(d ? "#FFA657" : "#B35C00"));
    m_key       = fmt(QColor(d ? "#79C0FF" : "#0550AE"));
    m_tag       = fmt(QColor(d ? "#7EE787" : "#116329"), true);
    m_attribute = fmt(QColor(d ? "#FFA657" : "#953800"));
    m_heading   = fmt(QColor(d ? "#F2B713" : "#C85A00"), true);
    m_emphasis  = fmt(QColor(d ? "#E6EDF3" : "#24292F"), false, true);
    m_strong    = fmt(QColor(d ? "#E6EDF3" : "#24292F"), true);
    m_code      = fmt(QColor(d ? "#E6EDF3" : "#24292F"));
    m_code.setBackground(QColor(d ? "#2D333B" : "#EEF0F2"));
    m_code.setFontFamily(QStringLiteral("monospace"));
    m_link      = fmt(QColor(d ? "#58A6FF" : "#0969DA"));
    m_link.setFontUnderline(true);
    m_punct     = fmt(QColor(d ? "#8B949E" : "#57606A"));
    m_section   = fmt(QColor(d ? "#F2B713" : "#C85A00"), true);
    rebuildRules();
    rehighlight();
}

void Highlighter::rebuildRules()
{
    m_rules.clear();
    auto add = [this](const QString& re, const QTextCharFormat& f, int group = 0,
                      QRegularExpression::PatternOptions opts = QRegularExpression::NoPatternOption) {
        Rule r;
        r.pattern = QRegularExpression(re, opts);
        r.format = f;
        r.group = group;
        m_rules.append(r);
    };

    switch (m_language) {
    case Language::Json:
        add(QStringLiteral("[{}\\[\\],:]"), m_punct);
        add(QStringLiteral("-?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b"), m_number);
        add(QStringLiteral("\\b(?:true|false|null)\\b"), m_keyword);
        add(QStringLiteral("\"(?:[^\"\\\\]|\\\\.)*\""), m_string);
        add(QStringLiteral("\"(?:[^\"\\\\]|\\\\.)*\"(?=\\s*:)"), m_key);
        break;
    case Language::Xml:
        add(QStringLiteral("&[\\w#]+;"), m_number);
        add(QStringLiteral("</?[\\w:.-]+|/?>"), m_tag);
        add(QStringLiteral("<\\?[\\w:-]+|\\?>"), m_keyword);
        add(QStringLiteral("\\b[\\w:.-]+(?=\\s*=\\s*[\"'])"), m_attribute);
        add(QStringLiteral("\"[^\"]*\"|'[^']*'"), m_string);
        break;
    case Language::Yaml:
        add(QStringLiteral("-?\\b\\d+(?:\\.\\d+)?\\b"), m_number);
        add(QStringLiteral("\\b(?:true|false|yes|no|on|off|null|True|False|Yes|No|NULL)\\b|~"), m_keyword);
        add(QStringLiteral("^\\s*(?:-\\s+)?([^#\\s][^:#]*?)(?=\\s*:(?:\\s|$))"), m_key, 1);
        add(QStringLiteral("^\\s*-(?=\\s)"), m_punct);
        add(QStringLiteral("[&*][\\w-]+"), m_attribute);
        add(QStringLiteral("\"(?:[^\"\\\\]|\\\\.)*\"|'[^']*'"), m_string);
        add(QStringLiteral("^(?:---|\\.\\.\\.)\\s*$"), m_keyword);
        add(QStringLiteral("(?:^|\\s)(#.*)$"), m_comment, 1);
        break;
    case Language::Markdown:
        add(QStringLiteral("^\\s*(?:[-*+]|\\d+\\.)(?=\\s)"), m_punct);
        add(QStringLiteral("(?<![*\\w])\\*(?!\\s)[^*\\n]+(?<!\\s)\\*(?!\\*)|(?<![_\\w])_(?!\\s)[^_\\n]+(?<!\\s)_(?![_\\w])"), m_emphasis);
        add(QStringLiteral("\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__"), m_strong);
        add(QStringLiteral("!?\\[[^\\]\\n]*\\]\\([^)\\n]*\\)|<https?://[^>\\s]+>"), m_link);
        add(QStringLiteral("`[^`\\n]+`"), m_code);
        add(QStringLiteral("^\\s*>.*$"), m_comment);
        add(QStringLiteral("^#{1,6}\\s.*$"), m_heading);
        break;
    case Language::Ini:
        add(QStringLiteral("(?<==)\\s*-?\\d+(?:\\.\\d+)?\\s*$"), m_number);
        add(QStringLiteral("(?<==)\\s*(?:true|false|yes|no|on|off)\\s*$"), m_keyword, 0,
            QRegularExpression::CaseInsensitiveOption);
        add(QStringLiteral("\"[^\"]*\"|'[^']*'"), m_string);
        add(QStringLiteral("^\\s*[^=;#\\[\\s][^=]*?(?=\\s*=)"), m_key);
        add(QStringLiteral("^\\s*\\[[^\\]]+\\]"), m_section);
        add(QStringLiteral("^\\s*[;#].*$"), m_comment);
        break;
    case Language::None:
        break;
    }
}

void Highlighter::applyRules(const QString& text)
{
    for (const Rule& rule : m_rules) {
        QRegularExpressionMatchIterator it = rule.pattern.globalMatch(text);
        while (it.hasNext()) {
            const QRegularExpressionMatch m = it.next();
            const int start = m.capturedStart(rule.group);
            const int len = m.capturedLength(rule.group);
            if (start >= 0 && len > 0)
                setFormat(start, len, rule.format);
        }
    }
}

void Highlighter::highlightXmlComments(const QString& text)
{
    static const QRegularExpression open(QStringLiteral("<!--"));
    static const QRegularExpression close(QStringLiteral("-->"));
    int start = 0;
    if (previousBlockState() != InXmlComment) {
        const QRegularExpressionMatch m = open.match(text);
        start = m.hasMatch() ? m.capturedStart() : -1;
    }
    while (start >= 0) {
        const QRegularExpressionMatch end = close.match(text, start);
        int length;
        if (end.hasMatch()) {
            length = end.capturedEnd() - start;
            setCurrentBlockState(Normal);
        } else {
            length = text.length() - start;
            setCurrentBlockState(InXmlComment);
        }
        setFormat(start, length, m_comment);
        const QRegularExpressionMatch next = open.match(text, start + length);
        start = next.hasMatch() ? next.capturedStart() : -1;
    }
}

bool Highlighter::highlightMarkdownFence(const QString& text)
{
    const bool fenceLine = text.trimmed().startsWith(QLatin1String("```"))
                           || text.trimmed().startsWith(QLatin1String("~~~"));
    const bool inside = previousBlockState() == InMarkdownFence;
    if (inside || fenceLine) {
        setFormat(0, text.length(), m_code);
        if (fenceLine)
            setCurrentBlockState(inside ? Normal : InMarkdownFence);
        else
            setCurrentBlockState(InMarkdownFence);
        return true;
    }
    return false;
}

void Highlighter::highlightBlock(const QString& text)
{
    setCurrentBlockState(Normal);
    if (m_language == Language::None)
        return;
    if (m_language == Language::Markdown && highlightMarkdownFence(text))
        return;
    applyRules(text);
    if (m_language == Language::Xml)
        highlightXmlComments(text);
}
