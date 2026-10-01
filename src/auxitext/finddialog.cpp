/*
 * AuxiText — éditeur de texte brut d'AuxiNux Office
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

#include "finddialog.h"

#include <QCheckBox>
#include <QGridLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QLineEdit>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QTextCursor>
#include <QVBoxLayout>

FindDialog::FindDialog(QPlainTextEdit* editor, QWidget* parent)
    : QDialog(parent)
    , m_editor(editor)
{
    setModal(false);
    m_findLabel = new QLabel(this);
    m_replaceLabel = new QLabel(this);
    m_find = new QLineEdit(this);
    m_replace = new QLineEdit(this);
    m_findLabel->setBuddy(m_find);
    m_replaceLabel->setBuddy(m_replace);
    m_case = new QCheckBox(this);
    m_words = new QCheckBox(this);
    m_regex = new QCheckBox(this);
    m_next = new QPushButton(this);
    m_prev = new QPushButton(this);
    m_replaceOne = new QPushButton(this);
    m_replaceAll = new QPushButton(this);
    m_close = new QPushButton(this);
    m_status = new QLabel(this);
    m_next->setDefault(true);

    auto* grid = new QGridLayout;
    grid->addWidget(m_findLabel, 0, 0);
    grid->addWidget(m_find, 0, 1);
    grid->addWidget(m_replaceLabel, 1, 0);
    grid->addWidget(m_replace, 1, 1);
    auto* options = new QHBoxLayout;
    options->addWidget(m_case);
    options->addWidget(m_words);
    options->addWidget(m_regex);
    options->addStretch();
    grid->addLayout(options, 2, 1);

    auto* buttons = new QVBoxLayout;
    buttons->addWidget(m_next);
    buttons->addWidget(m_prev);
    buttons->addWidget(m_replaceOne);
    buttons->addWidget(m_replaceAll);
    buttons->addStretch();
    buttons->addWidget(m_close);

    auto* top = new QHBoxLayout;
    top->addLayout(grid, 1);
    top->addLayout(buttons);
    auto* root = new QVBoxLayout(this);
    root->addLayout(top);
    root->addWidget(m_status);

    connect(m_next, &QPushButton::clicked, this, [this] { findNext(false); });
    connect(m_prev, &QPushButton::clicked, this, [this] { findNext(true); });
    connect(m_replaceOne, &QPushButton::clicked, this, &FindDialog::replaceCurrent);
    connect(m_replaceAll, &QPushButton::clicked, this, [this] { replaceAll(); });
    connect(m_close, &QPushButton::clicked, this, &QDialog::hide);
    connect(m_find, &QLineEdit::returnPressed, this, [this] { findNext(false); });
    connect(m_regex, &QCheckBox::toggled, this, [this](bool on) { m_words->setEnabled(!on); });
    retranslate();
}

void FindDialog::retranslate()
{
    setWindowTitle(tr("Find and Replace"));
    m_findLabel->setText(tr("&Find:"));
    m_replaceLabel->setText(tr("Replace &with:"));
    m_case->setText(tr("Match &case"));
    m_words->setText(tr("&Whole words"));
    m_regex->setText(tr("Regular e&xpression"));
    m_next->setText(tr("Find &Next"));
    m_prev->setText(tr("Find &Previous"));
    m_replaceOne->setText(tr("&Replace"));
    m_replaceAll->setText(tr("Replace &All"));
    m_close->setText(tr("Close"));
}

void FindDialog::showFind()
{
    const QString selected = m_editor->textCursor().selectedText();
    if (!selected.isEmpty() && !selected.contains(QChar::ParagraphSeparator))
        m_find->setText(selected);
    m_replace->setVisible(false);
    m_replaceLabel->setVisible(false);
    m_replaceOne->setVisible(false);
    m_replaceAll->setVisible(false);
    setWindowTitle(tr("Find"));
    m_status->clear();
    show();
    raise();
    activateWindow();
    m_find->setFocus();
    m_find->selectAll();
}

void FindDialog::showReplace()
{
    showFind();
    m_replace->setVisible(true);
    m_replaceLabel->setVisible(true);
    m_replaceOne->setVisible(true);
    m_replaceAll->setVisible(true);
    setWindowTitle(tr("Find and Replace"));
}

bool FindDialog::isRegex() const
{
    return m_regex->isChecked();
}

QRegularExpression FindDialog::pattern() const
{
    QString expr = isRegex() ? m_find->text() : QRegularExpression::escape(m_find->text());
    if (!isRegex() && m_words->isChecked())
        expr = QStringLiteral("\\b") + expr + QStringLiteral("\\b");
    QRegularExpression::PatternOptions opts = QRegularExpression::UseUnicodePropertiesOption;
    if (!m_case->isChecked())
        opts |= QRegularExpression::CaseInsensitiveOption;
    return QRegularExpression(expr, opts);
}

QTextDocument::FindFlags FindDialog::flags(bool backward) const
{
    QTextDocument::FindFlags f;
    if (backward)
        f |= QTextDocument::FindBackward;
    if (m_case->isChecked())
        f |= QTextDocument::FindCaseSensitively;
    return f;
}

void FindDialog::setStatus(const QString& text, bool error)
{
    m_status->setText(text);
    m_status->setStyleSheet(error ? QStringLiteral("color:#C8283C") : QString());
}

bool FindDialog::findNext(bool backward)
{
    if (m_find->text().isEmpty())
        return false;
    const QRegularExpression re = pattern();
    if (!re.isValid()) {
        setStatus(tr("Invalid regular expression: %1").arg(re.errorString()), true);
        return false;
    }
    QTextDocument* doc = m_editor->document();
    QTextCursor found = doc->find(re, m_editor->textCursor(), flags(backward));
    if (found.isNull()) {
        QTextCursor wrap(doc);
        if (backward)
            wrap.movePosition(QTextCursor::End);
        found = doc->find(re, wrap, flags(backward));
        if (!found.isNull())
            setStatus(backward ? tr("Search wrapped to the end") : tr("Search wrapped to the beginning"));
    } else {
        setStatus(QString());
    }
    if (found.isNull()) {
        setStatus(tr("No match for “%1”").arg(m_find->text()), true);
        return false;
    }
    m_editor->setTextCursor(found);
    return true;
}

void FindDialog::replaceCurrent()
{
    QTextCursor cursor = m_editor->textCursor();
    const QRegularExpression re = pattern();
    if (cursor.hasSelection()) {
        const QString selected = cursor.selectedText();
        const QRegularExpressionMatch m = re.match(selected);
        if (m.hasMatch() && m.capturedLength() == selected.length()) {
            QString replacement = m_replace->text();
            if (isRegex())
                replacement = QString(selected).replace(re, m_replace->text());
            cursor.insertText(replacement);
        }
    }
    findNext(false);
}

int FindDialog::replaceAll()
{
    if (m_find->text().isEmpty())
        return 0;
    const QRegularExpression re = pattern();
    if (!re.isValid()) {
        setStatus(tr("Invalid regular expression: %1").arg(re.errorString()), true);
        return 0;
    }
    QTextDocument* doc = m_editor->document();
    QTextCursor cursor(doc);
    int count = 0;
    QTextCursor edit(doc);
    edit.beginEditBlock();     // une seule étape d'annulation
    while (true) {
        cursor = doc->find(re, cursor, flags(false));
        if (cursor.isNull() || !cursor.hasSelection())
            break;
        QString replacement = m_replace->text();
        if (isRegex())
            replacement = cursor.selectedText().replace(re, m_replace->text());
        cursor.insertText(replacement);
        ++count;
    }
    edit.endEditBlock();
    setStatus(tr("%n replacement(s)", nullptr, count));
    return count;
}
