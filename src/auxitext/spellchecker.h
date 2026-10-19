/*
 * AuxiText — éditeur de texte brut d'AuxiNux Office
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Correction du français par AuxiCorrect, programme séparé appelé en ligne de commande
 * (auxicorrect-cli verifier - --json). Rien n'est lié à AuxiCorrect : s'il est absent ou
 * désactivé, AuxiText fonctionne exactement comme avant.
 *
 * L'activation vient du réglage commun écrit par AuxiCorrect (Paramètres → Intégration) :
 *   Linux   : $XDG_CONFIG_HOME/auxinux/auxicorrect.json
 *   macOS   : ~/Library/Application Support/AuxiNux/auxicorrect.json
 *   Windows : %APPDATA%\AuxiNux\auxicorrect.json
 * clés lues : "cli" (chemin de l'outil) et "products"."auxitext"."enabled".
 */

#ifndef AUXITEXT_SPELLCHECKER_H
#define AUXITEXT_SPELLCHECKER_H

#include <QObject>
#include <QSet>
#include <QString>
#include <QStringList>
#include <QTimer>
#include <QVector>

class CodeEditor;
class QMenu;
class QProcess;

class SpellChecker : public QObject
{
    Q_OBJECT
public:
    struct Issue {
        int start = 0;      // positions dans le document (unités UTF-16, comme QString)
        int end = 0;
        QString category;   // Spelling, Grammar, Typography, Style, Regional
        QString severity;   // Error, Warning, Suggestion
        QString ruleId;
        QString message;
        QString text;
        QStringList suggestions;
    };

    explicit SpellChecker(CodeEditor* editor);
    ~SpellChecker() override;

    // Réglage commun d'AuxiCorrect
    static QString sharedConfigPath();
    void reloadSharedConfig();
    bool allowedByAuxiCorrect() const { return m_allowed; }   // activé dans AuxiCorrect, outil présent

    // Choix de l'utilisateur dans AuxiText (menu Affichage)
    void setUserEnabled(bool on);
    // Type de document : seuls le texte brut et le Markdown sont vérifiés
    void setDocumentEligible(bool on);
    bool isActive() const;

    // Menu contextuel : ajoute en tête les suggestions de la faute sous la position donnée
    void addContextActions(QMenu* menu, int position);

signals:
    void activeChanged(bool active);

private:
    void updateActive();
    void onContentsChange(int position, int removed, int added);
    void startCheck();
    void onFinished();
    void applyIssues();
    void clearIssues();
    const Issue* issueAt(int position) const;

    CodeEditor* m_editor;
    QProcess* m_process = nullptr;
    QTimer m_timer;
    QString m_cli;
    bool m_allowed = false;
    bool m_userEnabled = true;
    bool m_eligible = true;
    bool m_active = false;
    quint64 m_revision = 0;         // incrémenté à chaque modification du texte
    quint64 m_sentRevision = 0;
    QString m_sentText;
    QVector<Issue> m_issues;
    QSet<QString> m_ignored;        // « Ignorer » : règle + texte, pour la session
};

#endif // AUXITEXT_SPELLCHECKER_H
