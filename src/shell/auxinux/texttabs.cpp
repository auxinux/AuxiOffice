/*
 * AuxiNux Office — fichiers texte brut dans les onglets du shell (AuxiText intégré).
 *
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

#include "auxinux/texttabs.h"

#ifdef AUXI_TEXT_TABS

#include "cascapplicationmanagerwrapper.h"
#include "clangater.h"
#include "components/asctabwidget.h"
#include "components/ctabbar.h"
#include "components/ctabpanel.h"
#include "windows/cmainwindow.h"
#include "mainwindow.h"                 // AuxiText (src/auxitext, copié dans src/auxinux/auxitext)

#include <QCoreApplication>
#include <QDir>
#include <QEvent>
#include <QFileInfo>
#include <QHash>
#include <QIcon>
#include <QLayout>
#include <QPointer>
#include <QTranslator>

namespace AuxiNux {

namespace {

bool samePath(const QString& a, const QString& b)
{
#ifdef _WIN32
    return QDir::cleanPath(a).compare(QDir::cleanPath(b), Qt::CaseInsensitive) == 0;
#else
    return QDir::cleanPath(a) == QDir::cleanPath(b);
#endif
}

class TextTabs : public QObject, public TextHost
{
public:
    static TextTabs& instance()
    {
        static TextTabs tabs;
        return tabs;
    }

    bool open(const QString& path)
    {
        CMainWindow* window = AscAppManager::mainWindow();
        if ( !window )
            return false;
        installTextTranslator();

        const QString file = path.isEmpty() ? QString() : QFileInfo(path).absoluteFilePath();
        if ( !file.isEmpty() ) {
            for ( auto it = m_editors.constBegin(); it != m_editors.constEnd(); ++it )
                if ( it.value() && samePath(it.value()->filePath(), file) ) {
                    window->selectView(it.key()->cef()->GetId());
                    it.value()->focusEditor();
                    return true;
                }
        }

        // Fichier lu avant de créer l'onglet : en cas d'erreur (message déjà affiché), pas d'onglet.
        MainWindow* editor = new MainWindow(nullptr, this);
        if ( !file.isEmpty() && !editor->openFile(file) ) {
            delete editor;
            return true;
        }

        // Vue du moteur web exigée par la gestion des onglets (identifiant, fermeture) : vide et cachée.
        CTabPanel* panel = new CTabPanel(nullptr, QSize());
        panel->view()->Create(&AscAppManager::getInstance(), cvwtEditor);
        panel->cef()->load(L"about:blank");
        panel->view()->hide();
        editor->setParent(panel);
        panel->layout()->addWidget(editor);

        CAscTabData* data = new CAscTabData(editor->displayName(), cvwtEditor);
        data->setIsLocal(true);
        data->setUrl(editor->filePath());
        panel->setData(data);

        m_editors.insert(panel, editor);
        connect(panel, &QObject::destroyed, this, [this, panel] { m_editors.remove(panel); });
        panel->installEventFilter(this);

        const int index = window->attachEditor(panel, -1);
        if ( index >= 0 )
            window->tabWidget()->tabBar()->setTabIcon(index, QIcon(QStringLiteral(":/auxinux/icons/auxitext.svg")));
        editor->setDarkTheme(AscAppManager::themes().current().isDark());
        editor->show();
        editor->focusEditor();
        editorStateChanged(editor);
        return true;
    }

    MainWindow* editorOf(QWidget* widget) const
    {
        CTabPanel* panel = qobject_cast<CTabPanel*>(widget);
        return panel ? m_editors.value(panel).data() : nullptr;
    }

    // TextHost
    void openInNewEditor(const QString& path) override
    {
        open(path);
    }

    void closeEditor(MainWindow* editor) override
    {
        CTabPanel* panel = panelOf(editor);
        CMainWindow* window = AscAppManager::mainWindow();
        if ( !panel || !window )
            return;
        const int index = window->tabWidget()->tabIndexByView(panel->cef()->GetId());
        if ( index >= 0 )   // tabCloseRequest(-1) fermerait l'onglet courant
            window->tabCloseRequest(index);
    }

    void editorStateChanged(MainWindow* editor) override
    {
        CTabPanel* panel = panelOf(editor);
        CMainWindow* window = AscAppManager::mainWindow();
        if ( !panel || !window )
            return;     // éditeur en cours de création
        const int id = panel->cef()->GetId();
        window->tabWidget()->applyDocumentChanging(id, editor->displayName(), QDir::toNativeSeparators(editor->filePath()));
        window->onDocumentChanged(id, editor->isModified());
    }

protected:
    bool eventFilter(QObject* watched, QEvent* event) override
    {
        // Thème clair/sombre d'AuxiNux Office : appliqué quand l'onglet s'affiche.
        if ( event->type() == QEvent::Show )
            if ( MainWindow* editor = editorOf(qobject_cast<QWidget*>(watched)) )
                editor->setDarkTheme(AscAppManager::themes().current().isDark());
        return QObject::eventFilter(watched, event);
    }

private:
    CTabPanel* panelOf(MainWindow* editor) const
    {
        for ( auto it = m_editors.constBegin(); it != m_editors.constEnd(); ++it )
            if ( it.value() == editor )
                return it.key();
        return nullptr;
    }

    QHash<CTabPanel*, QPointer<MainWindow>> m_editors;
};

}

bool openTextTab(const QString& path)
{
    return TextTabs::instance().open(path);
}

bool isTextTab(QWidget* panel)
{
    return TextTabs::instance().editorOf(panel) != nullptr;
}

int saveTextTab(QWidget* panel)
{
    MainWindow* editor = TextTabs::instance().editorOf(panel);
    if ( !editor )
        return 0;
    return editor->save() ? 1 : -1;
}

void installTextTranslator()
{
    static QTranslator* translator = nullptr;
    if ( translator )
        return;
    translator = new QTranslator(qApp);
    const QString lang = CLangater::getCurrentLangCode().left(2).toLower();
    if ( translator->load(QStringLiteral(":/auxinux/i18n/auxitext_%1.qm").arg(lang)) )
        QCoreApplication::installTranslator(translator);
}

}

#else   // AuxiText non compilé dans le shell : fichiers texte ouverts dans l'application AuxiText

namespace AuxiNux {
bool openTextTab(const QString&) { return false; }
bool isTextTab(QWidget*) { return false; }
int saveTextTab(QWidget*) { return 0; }
void installTextTranslator() {}
}

#endif
