/*
 * AuxiText — éditeur de texte brut d'AuxiNux Office
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Boîte « Rechercher / Remplacer » non modale.
 */

#ifndef AUXITEXT_FINDDIALOG_H
#define AUXITEXT_FINDDIALOG_H

#include <QDialog>
#include <QRegularExpression>
#include <QTextDocument>

class QCheckBox;
class QLabel;
class QLineEdit;
class QPushButton;
class QPlainTextEdit;

class FindDialog : public QDialog
{
    Q_OBJECT
public:
    FindDialog(QPlainTextEdit* editor, QWidget* parent);

    void showFind();
    void showReplace();
    bool findNext(bool backward = false);
    int replaceAll();
    void retranslate();

private:
    bool isRegex() const;
    QRegularExpression pattern() const;
    QTextDocument::FindFlags flags(bool backward) const;
    void replaceCurrent();
    void setStatus(const QString& text, bool error = false);

    QPlainTextEdit* m_editor;
    QLabel* m_findLabel;
    QLabel* m_replaceLabel;
    QLineEdit* m_find;
    QLineEdit* m_replace;
    QCheckBox* m_case;
    QCheckBox* m_words;
    QCheckBox* m_regex;
    QPushButton* m_next;
    QPushButton* m_prev;
    QPushButton* m_replaceOne;
    QPushButton* m_replaceAll;
    QPushButton* m_close;
    QLabel* m_status;
};

#endif // AUXITEXT_FINDDIALOG_H
