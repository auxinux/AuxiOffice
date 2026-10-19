/*
 * AuxiText — éditeur de texte brut d'AuxiNux Office
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

#include "spellchecker.h"

#include "codeeditor.h"

#include <QAction>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QFont>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMenu>
#include <QProcess>
#include <QProcessEnvironment>
#include <QStandardPaths>
#include <QTextBlock>
#include <QTextCursor>
#include <QTextDocument>

namespace {
const int kDelayMs = 800;           // pause de frappe avant la vérification
const int kMaxChars = 200000;       // au-delà, pas de vérification (journaux, gros fichiers)
const int kMaxSuggestions = 6;
const char kProductKey[] = "auxitext";
// Nom du réglage commun, gardé en texte ASCII dans l'exécutable : AuxiCorrect y reconnaît
// une version d'AuxiText qui sait l'utiliser.
const char kSharedFile[] = "auxicorrect.json";

QString ignoreKey(const QString& ruleId, const QString& text)
{
    return ruleId + QChar(0x1F) + text;
}

QColor underlineColor(const QString& category)
{
    if (category == QLatin1String("Spelling"))
        return QColor(0xD9, 0x30, 0x25);
    if (category == QLatin1String("Grammar"))
        return QColor(0x1A, 0x73, 0xE8);
    return QColor(0xE6, 0x7E, 0x22);   // typographie, style, particularités régionales
}
}

SpellChecker::SpellChecker(CodeEditor* editor)
    : QObject(editor)
    , m_editor(editor)
{
    m_timer.setSingleShot(true);
    m_timer.setInterval(kDelayMs);
    connect(&m_timer, &QTimer::timeout, this, &SpellChecker::startCheck);
    connect(m_editor->document(), &QTextDocument::contentsChange, this, &SpellChecker::onContentsChange);
    m_editor->setContextMenuHook([this](QMenu* menu, int position) { addContextActions(menu, position); });
    reloadSharedConfig();
}

SpellChecker::~SpellChecker()
{
    if (m_process) {
        m_process->disconnect(this);
        m_process->kill();
        m_process->waitForFinished(1000);
    }
}

QString SpellChecker::sharedConfigPath()
{
#if defined(Q_OS_WIN)
    const QString base = QProcessEnvironment::systemEnvironment().value(QStringLiteral("APPDATA"));
    if (base.isEmpty())
        return QString();
    return QDir(base).filePath(QStringLiteral("AuxiNux/") + QLatin1String(kSharedFile));
#elif defined(Q_OS_MACOS)
    return QDir::homePath() + QStringLiteral("/Library/Application Support/AuxiNux/") + QLatin1String(kSharedFile);
#else
    QString base = QProcessEnvironment::systemEnvironment().value(QStringLiteral("XDG_CONFIG_HOME"));
    if (base.isEmpty() || !QDir::isAbsolutePath(base))
        base = QDir::homePath() + QStringLiteral("/.config");
    return base + QStringLiteral("/auxinux/") + QLatin1String(kSharedFile);
#endif
}

void SpellChecker::reloadSharedConfig()
{
    m_allowed = false;
    m_cli.clear();
    QFile file(sharedConfigPath());
    if (file.open(QIODevice::ReadOnly)) {
        const QJsonObject root = QJsonDocument::fromJson(file.readAll()).object();
        const QJsonObject product = root.value(QStringLiteral("products")).toObject()
                                        .value(QLatin1String(kProductKey)).toObject();
        const QString cli = root.value(QStringLiteral("cli")).toString();
        if (product.value(QStringLiteral("enabled")).toBool() && !cli.isEmpty() && QFileInfo(cli).isExecutable()) {
            m_allowed = true;
            m_cli = cli;
        }
    }
    updateActive();
}

void SpellChecker::setUserEnabled(bool on)
{
    m_userEnabled = on;
    updateActive();
}

void SpellChecker::setDocumentEligible(bool on)
{
    m_eligible = on;
    updateActive();
}

bool SpellChecker::isActive() const
{
    return m_active;
}

void SpellChecker::updateActive()
{
    const bool active = m_allowed && m_userEnabled && m_eligible;
    if (active == m_active)
        return;
    m_active = active;
    if (m_active) {
        m_timer.start(0);
    } else {
        m_timer.stop();
        clearIssues();
    }
    emit activeChanged(m_active);
}

void SpellChecker::onContentsChange(int position, int removed, int added)
{
    ++m_revision;
    if (!m_active)
        return;
    // Décale les fautes situées après la modification ; retire celles qu'elle touche.
    const int delta = added - removed;
    QVector<Issue> kept;
    kept.reserve(m_issues.size());
    for (Issue issue : m_issues) {
        if (issue.end <= position) {
            kept.append(issue);
        } else if (issue.start >= position + removed) {
            issue.start += delta;
            issue.end += delta;
            kept.append(issue);
        }
    }
    if (kept.size() != m_issues.size() || delta != 0) {
        m_issues = kept;
        applyIssues();
    }
    m_timer.start();
}

void SpellChecker::startCheck()
{
    if (!m_active)
        return;
    if (m_process) {            // vérification en cours : on relancera à la fin
        m_timer.start();
        return;
    }
    const QString text = m_editor->toPlainText();
    if (text.size() > kMaxChars || text.trimmed().isEmpty()) {
        clearIssues();
        return;
    }
    m_sentText = text;
    m_sentRevision = m_revision;
    m_process = new QProcess(this);
    m_process->setProcessChannelMode(QProcess::SeparateChannels);
    connect(m_process, static_cast<void (QProcess::*)(int, QProcess::ExitStatus)>(&QProcess::finished),
            this, [this](int, QProcess::ExitStatus) { onFinished(); });
    connect(m_process, &QProcess::errorOccurred, this, [this](QProcess::ProcessError error) {
        if (error == QProcess::FailedToStart)
            onFinished();
    });
    m_process->start(m_cli, QStringList() << QStringLiteral("verifier") << QStringLiteral("-") << QStringLiteral("--json"));
    m_process->write(text.toUtf8());
    m_process->closeWriteChannel();
}

void SpellChecker::onFinished()
{
    QProcess* process = m_process;
    m_process = nullptr;
    if (!process)
        return;
    const QByteArray out = process->readAllStandardOutput();
    process->deleteLater();
    if (!m_active)
        return;
    if (m_sentRevision != m_revision) {     // texte modifié pendant la vérification
        m_timer.start();
        return;
    }
    // Le code de sortie vaut 1 dès qu'il y a une faute : seul un tableau JSON valide compte.
    const QJsonDocument doc = QJsonDocument::fromJson(out);
    if (!doc.isArray())
        return;

    // Positions de l'outil en points de code Unicode → unités UTF-16 de QString.
    QVector<int> offset;
    offset.reserve(m_sentText.size() + 1);
    for (int i = 0; i < m_sentText.size(); ++i) {
        offset.append(i);
        if (m_sentText.at(i).isHighSurrogate() && i + 1 < m_sentText.size() && m_sentText.at(i + 1).isLowSurrogate())
            ++i;
    }
    offset.append(m_sentText.size());

    QVector<Issue> issues;
    for (const QJsonValue& v : doc.array()) {
        const QJsonObject o = v.toObject();
        const int s = o.value(QStringLiteral("start_char")).toInt(-1);
        const int e = o.value(QStringLiteral("end_char")).toInt(-1);
        if (s < 0 || e <= s || e >= offset.size())
            continue;
        Issue issue;
        issue.start = offset.at(s);
        issue.end = offset.at(e);
        issue.category = o.value(QStringLiteral("category")).toString();
        issue.severity = o.value(QStringLiteral("severity")).toString();
        issue.ruleId = o.value(QStringLiteral("rule_id")).toString();
        issue.message = o.value(QStringLiteral("message")).toString();
        issue.text = m_sentText.mid(issue.start, issue.end - issue.start);
        for (const QJsonValue& sug : o.value(QStringLiteral("suggestions")).toArray())
            issue.suggestions.append(sug.toString());
        if (!m_ignored.contains(ignoreKey(issue.ruleId, issue.text)))
            issues.append(issue);
    }
    m_issues = issues;
    applyIssues();
}

void SpellChecker::applyIssues()
{
    QList<QTextEdit::ExtraSelection> selections;
    QTextDocument* doc = m_editor->document();
    for (const Issue& issue : m_issues) {
        QTextEdit::ExtraSelection sel;
        sel.cursor = QTextCursor(doc);
        sel.cursor.setPosition(issue.start);
        sel.cursor.setPosition(issue.end, QTextCursor::KeepAnchor);
        QColor color = underlineColor(issue.category);
        if (issue.severity == QLatin1String("Suggestion"))
            color.setAlpha(150);
        sel.format.setUnderlineStyle(QTextCharFormat::SpellCheckUnderline);
        sel.format.setUnderlineColor(color);
        selections.append(sel);
    }
    m_editor->setDiagnosticSelections(selections);
}

void SpellChecker::clearIssues()
{
    if (m_issues.isEmpty())
        return;
    m_issues.clear();
    applyIssues();
}

const SpellChecker::Issue* SpellChecker::issueAt(int position) const
{
    for (const Issue& issue : m_issues) {
        if (position >= issue.start && position <= issue.end)
            return &issue;
    }
    return nullptr;
}

void SpellChecker::addContextActions(QMenu* menu, int position)
{
    if (!m_active)
        return;
    const Issue* found = issueAt(position);
    if (!found)
        return;
    const Issue issue = *found;
    QAction* first = menu->actions().isEmpty() ? nullptr : menu->actions().first();
    QList<QAction*> added;

    QAction* title = new QAction(QFontMetrics(menu->font()).elidedText(issue.message, Qt::ElideRight, 420), menu);
    title->setEnabled(false);
    title->setToolTip(issue.message);
    added.append(title);

    const int count = qMin(kMaxSuggestions, issue.suggestions.size());
    for (int i = 0; i < count; ++i) {
        const QString suggestion = issue.suggestions.at(i);
        QAction* a = new QAction(suggestion.isEmpty() ? tr("(delete)") : suggestion, menu);
        if (i == 0) {
            QFont f = a->font();
            f.setBold(true);
            a->setFont(f);
        }
        connect(a, &QAction::triggered, this, [this, issue, suggestion] {
            QTextCursor c(m_editor->document());
            c.setPosition(issue.start);
            c.setPosition(issue.end, QTextCursor::KeepAnchor);
            if (c.selectedText() != issue.text)     // le texte a changé entre-temps
                return;
            c.insertText(suggestion);
        });
        added.append(a);
    }
    if (count == 0) {
        QAction* none = new QAction(tr("No suggestion"), menu);
        none->setEnabled(false);
        added.append(none);
    }

    QAction* ignore = new QAction(tr("Ignore"), menu);
    connect(ignore, &QAction::triggered, this, [this, issue] {
        m_ignored.insert(ignoreKey(issue.ruleId, issue.text));
        QVector<Issue> kept;
        for (const Issue& i : m_issues) {
            if (!(i.ruleId == issue.ruleId && i.text == issue.text))
                kept.append(i);
        }
        m_issues = kept;
        applyIssues();
    });
    added.append(ignore);

    QAction* sep = new QAction(menu);
    sep->setSeparator(true);
    added.append(sep);
    menu->insertActions(first, added);
}
