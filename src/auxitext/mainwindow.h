/*
 * AuxiText — éditeur de texte brut d'AuxiNux Office
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

#ifndef AUXITEXT_MAINWINDOW_H
#define AUXITEXT_MAINWINDOW_H

#include "highlighter.h"
#include "textio.h"

#include <QMainWindow>
#include <QPointer>

class CodeEditor;
class FindDialog;
class QAction;
class QActionGroup;
class QFileSystemWatcher;
class QLabel;
class QMenu;

class MainWindow;

// Programme qui intègre AuxiText dans sa propre interface (onglets d'AuxiNux Office) :
// l'éditeur devient un widget enfant, sans fenêtre ni réglages de fenêtre propres.
class TextHost
{
public:
    virtual ~TextHost() = default;
    virtual void openInNewEditor(const QString& path) = 0;   // nouvel éditeur (vide si path est vide)
    virtual void closeEditor(MainWindow* editor) = 0;        // l'utilisateur ferme cet éditeur
    virtual void editorStateChanged(MainWindow* editor) = 0; // nom, chemin ou état « modifié »
};

class MainWindow : public QMainWindow
{
    Q_OBJECT
public:
    explicit MainWindow(QWidget* parent = nullptr, TextHost* host = nullptr);
    ~MainWindow() override;

    bool openFile(const QString& path);
    bool isUntitledAndEmpty() const;
    static MainWindow* openInNewWindow(const QString& path = QString());

    // Pour le programme hôte
    QString filePath() const { return m_path; }
    QString displayName() const;    // nom du fichier, ou « Sans titre »
    bool isModified() const;
    bool save();
    bool maybeSave();
    void setDarkTheme(bool dark);   // thème imposé par l'hôte (palette de ce widget seulement)
    void focusEditor();

protected:
    void closeEvent(QCloseEvent* event) override;
    void dragEnterEvent(QDragEnterEvent* event) override;
    void dropEvent(QDropEvent* event) override;
    void changeEvent(QEvent* event) override;

private:
    void createActions();
    void createMenus();
    void createStatusBar();
    void retranslate();
    void readSettings();
    void writeSettings();

    void newFile();
    void open();
    void openElsewhere(const QString& path);
    bool saveAs();
    bool saveTo(const QString& path);
    void reload();
    void print();
    void openInWriter();
    void goToLine();
    void about();
    void showLicenses();

    void setCurrentFile(const QString& path);
    void updateTitle();
    void updateStatus();
    void updateRecentMenu();
    void addRecent(const QString& path);
    void applyTheme();
    void setEncoding(TextIO::Encoding encoding);
    void setEol(TextIO::Eol eol);
    void setLanguage(int language);  // -1 = automatique
    void onFileChangedOnDisk(const QString& path);

    static QList<MainWindow*>& instances();

    TextHost* m_host;
    CodeEditor* m_editor;
    Highlighter* m_highlighter;
    QPointer<FindDialog> m_find;
    QFileSystemWatcher* m_watcher;

    QString m_path;
    TextIO::Encoding m_encoding = TextIO::Encoding::Utf8;
    TextIO::Eol m_eol = TextIO::platformEol();
    int m_languageOverride = -1;
    bool m_ignoreNextChange = false;

    QLabel* m_posLabel;
    QLabel* m_encodingLabel;
    QLabel* m_eolLabel;
    QLabel* m_langLabel;

    QMenu *m_fileMenu, *m_editMenu, *m_viewMenu, *m_documentMenu, *m_helpMenu;
    QMenu *m_recentMenu, *m_themeMenu, *m_eolMenu, *m_encodingMenu, *m_syntaxMenu, *m_uiLangMenu;
    QAction *m_newAct, *m_newWindowAct, *m_openAct, *m_saveAct, *m_saveAsAct, *m_reloadAct, *m_printAct,
            *m_openWriterAct, *m_closeAct, *m_quitAct;
    QAction *m_undoAct, *m_redoAct, *m_cutAct, *m_copyAct, *m_pasteAct, *m_selectAllAct,
            *m_findAct, *m_findNextAct, *m_findPrevAct, *m_replaceAct, *m_gotoAct;
    QAction *m_wrapAct, *m_lineNumbersAct, *m_zoomInAct, *m_zoomOutAct, *m_zoomResetAct;
    QAction *m_themeSystemAct, *m_themeLightAct, *m_themeDarkAct;
    QAction *m_uiLangSystemAct, *m_uiLangFrAct, *m_uiLangEnAct;
    QAction *m_aboutAct, *m_licensesAct;
    QActionGroup *m_eolGroup, *m_encodingGroup, *m_syntaxGroup, *m_themeGroup, *m_uiLangGroup;
};

#endif // AUXITEXT_MAINWINDOW_H
