/*
 * AuxiText — éditeur de texte brut d'AuxiNux Office
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Coloration syntaxique minimale (JSON, XML, YAML, Markdown, INI) à base de
 * règles d'expressions régulières, avec états multilignes (commentaires XML,
 * blocs de code Markdown).
 */

#ifndef AUXITEXT_HIGHLIGHTER_H
#define AUXITEXT_HIGHLIGHTER_H

#include <QRegularExpression>
#include <QSyntaxHighlighter>
#include <QTextCharFormat>
#include <QVector>

class Highlighter : public QSyntaxHighlighter
{
    Q_OBJECT
public:
    enum class Language { None, Json, Xml, Yaml, Markdown, Ini };

    explicit Highlighter(QTextDocument* parent);

    void setLanguage(Language language);
    Language language() const { return m_language; }
    void setDarkPalette(bool dark);

    static Language languageForFile(const QString& fileName);
    static QString languageName(Language language);

protected:
    void highlightBlock(const QString& text) override;

private:
    struct Rule {
        QRegularExpression pattern;
        QTextCharFormat format;
        int group = 0;
    };

    void rebuildRules();
    void applyRules(const QString& text);
    void highlightXmlComments(const QString& text);
    bool highlightMarkdownFence(const QString& text);

    Language m_language = Language::None;
    bool m_dark = false;
    QVector<Rule> m_rules;
    QTextCharFormat m_comment, m_keyword, m_string, m_number, m_key, m_tag, m_attribute,
                    m_heading, m_emphasis, m_strong, m_code, m_link, m_punct, m_section;
};

#endif // AUXITEXT_HIGHLIGHTER_H
