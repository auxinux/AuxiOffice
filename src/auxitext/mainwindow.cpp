/*
 * AuxiText — éditeur de texte brut d'AuxiNux Office
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

#include "mainwindow.h"

#include "app.h"
#include "codeeditor.h"
#include "finddialog.h"

#include <QAction>
#include <QActionGroup>
#include <QApplication>
#include <QCloseEvent>
#include <QDesktopServices>
#include <QDir>
#include <QDragEnterEvent>
#include <QDropEvent>
#include <QFile>
#include <QFileDialog>
#include <QFileInfo>
#include <QFileSystemWatcher>
#include <QInputDialog>
#include <QLabel>
#include <QMenu>
#include <QMenuBar>
#include <QMessageBox>
#include <QMimeData>
#include <QProcess>
#include <QSaveFile>
#include <QStatusBar>
#include <QTextBlock>
#include <QTimer>
#include <QUrl>

#ifndef QT_NO_PRINTER
# include <QPrintDialog>
# include <QPrinter>
#endif

namespace {
const int kMaxRecent = 10;
const qint64 kLargeFile = 64LL * 1024 * 1024;
}

MainWindow::MainWindow(QWidget* parent, TextHost* host)
    : QMainWindow(parent)
    , m_host(host)
    , m_editor(new CodeEditor(this))
    , m_highlighter(new Highlighter(m_editor->document()))
    , m_watcher(new QFileSystemWatcher(this))
{
    instances().append(this);
    if (m_host)
        setWindowFlags(Qt::Widget);     // widget enfant de l'hôte (onglet)
    else
        setAttribute(Qt::WA_DeleteOnClose);
    setAcceptDrops(true);
    m_editor->setAcceptDrops(false);
    setCentralWidget(m_editor);

    createActions();
    createMenus();
    createStatusBar();
    retranslate();
    readSettings();
    if (!m_host)
        applyTheme();

    connect(m_editor->document(), &QTextDocument::modificationChanged, this, [this](bool) { updateTitle(); });
    connect(m_editor, &QPlainTextEdit::cursorPositionChanged, this, &MainWindow::updateStatus);
    connect(m_watcher, &QFileSystemWatcher::fileChanged, this, &MainWindow::onFileChangedOnDisk);

    setCurrentFile(QString());
}

MainWindow::~MainWindow()
{
    instances().removeAll(this);
}

QList<MainWindow*>& MainWindow::instances()
{
    static QList<MainWindow*> list;
    return list;
}

QString MainWindow::displayName() const
{
    return m_path.isEmpty() ? tr("Untitled") : QFileInfo(m_path).fileName();
}

bool MainWindow::isModified() const
{
    return m_editor->document()->isModified();
}

void MainWindow::focusEditor()
{
    m_editor->setFocus();
}

void MainWindow::setDarkTheme(bool dark)
{
    // Palette du widget seulement : l'hôte garde la sienne.
    App::applyPalette(dark, this);
    m_editor->setDark(dark);
    m_highlighter->setDarkPalette(dark);
}

// Fichier ouvert ailleurs que dans cet éditeur : nouvel onglet de l'hôte ou nouvelle fenêtre.
void MainWindow::openElsewhere(const QString& path)
{
    if (m_host)
        m_host->openInNewEditor(path);
    else
        MainWindow::openInNewWindow(path);
}

MainWindow* MainWindow::openInNewWindow(const QString& path)
{
    auto* w = new MainWindow;
    if (!path.isEmpty() && !w->openFile(path)) {
        w->deleteLater();
        return nullptr;
    }
    w->show();
    return w;
}

bool MainWindow::isUntitledAndEmpty() const
{
    return m_path.isEmpty() && !m_editor->document()->isModified() && m_editor->document()->isEmpty();
}

// ---------------------------------------------------------------------------
// Actions & menus
// ---------------------------------------------------------------------------

void MainWindow::createActions()
{
    auto act = [this](const QKeySequence& key, void (MainWindow::*slot)()) {
        auto* a = new QAction(this);
        if (!key.isEmpty())
            a->setShortcut(key);
        if (slot)
            connect(a, &QAction::triggered, this, slot);
        return a;
    };

    m_newAct = act(QKeySequence::New, &MainWindow::newFile);
    m_newWindowAct = new QAction(this);
    m_newWindowAct->setShortcut(QKeySequence(QStringLiteral("Ctrl+Shift+N")));
    connect(m_newWindowAct, &QAction::triggered, this, [this] { openElsewhere(QString()); });
    m_openAct = act(QKeySequence::Open, &MainWindow::open);
    m_saveAct = new QAction(this);
    m_saveAct->setShortcut(QKeySequence::Save);
    connect(m_saveAct, &QAction::triggered, this, [this] { save(); });
    m_saveAsAct = new QAction(this);
    m_saveAsAct->setShortcut(QKeySequence::SaveAs);
    connect(m_saveAsAct, &QAction::triggered, this, [this] { saveAs(); });
    m_reloadAct = act(QKeySequence(QStringLiteral("Ctrl+R")), &MainWindow::reload);
    m_printAct = act(QKeySequence::Print, &MainWindow::print);
    m_openWriterAct = act(QKeySequence(), &MainWindow::openInWriter);
    m_closeAct = new QAction(this);
    m_closeAct->setShortcut(QKeySequence::Close);
    connect(m_closeAct, &QAction::triggered, this, [this] {
        if (m_host)
            m_host->closeEditor(this);
        else
            close();
    });
    m_quitAct = new QAction(this);
    m_quitAct->setShortcut(QKeySequence::Quit);
    connect(m_quitAct, &QAction::triggered, qApp, &QApplication::closeAllWindows);

    m_undoAct = new QAction(this);
    m_undoAct->setShortcut(QKeySequence::Undo);
    connect(m_undoAct, &QAction::triggered, m_editor, &QPlainTextEdit::undo);
    connect(m_editor, &QPlainTextEdit::undoAvailable, m_undoAct, &QAction::setEnabled);
    m_redoAct = new QAction(this);
    m_redoAct->setShortcut(QKeySequence::Redo);
    connect(m_redoAct, &QAction::triggered, m_editor, &QPlainTextEdit::redo);
    connect(m_editor, &QPlainTextEdit::redoAvailable, m_redoAct, &QAction::setEnabled);
    m_cutAct = new QAction(this);
    m_cutAct->setShortcut(QKeySequence::Cut);
    connect(m_cutAct, &QAction::triggered, m_editor, &QPlainTextEdit::cut);
    m_copyAct = new QAction(this);
    m_copyAct->setShortcut(QKeySequence::Copy);
    connect(m_copyAct, &QAction::triggered, m_editor, &QPlainTextEdit::copy);
    m_pasteAct = new QAction(this);
    m_pasteAct->setShortcut(QKeySequence::Paste);
    connect(m_pasteAct, &QAction::triggered, m_editor, &QPlainTextEdit::paste);
    m_selectAllAct = new QAction(this);
    m_selectAllAct->setShortcut(QKeySequence::SelectAll);
    connect(m_selectAllAct, &QAction::triggered, m_editor, &QPlainTextEdit::selectAll);
    m_undoAct->setEnabled(false);
    m_redoAct->setEnabled(false);

    m_find = new FindDialog(m_editor, this);
    m_findAct = new QAction(this);
    m_findAct->setShortcut(QKeySequence::Find);
    connect(m_findAct, &QAction::triggered, this, [this] { m_find->showFind(); });
    m_findNextAct = new QAction(this);
    m_findNextAct->setShortcut(QKeySequence::FindNext);
    connect(m_findNextAct, &QAction::triggered, this, [this] { m_find->findNext(false); });
    m_findPrevAct = new QAction(this);
    m_findPrevAct->setShortcut(QKeySequence::FindPrevious);
    connect(m_findPrevAct, &QAction::triggered, this, [this] { m_find->findNext(true); });
    m_replaceAct = new QAction(this);
    m_replaceAct->setShortcut(QKeySequence(QStringLiteral("Ctrl+H")));
    connect(m_replaceAct, &QAction::triggered, this, [this] { m_find->showReplace(); });
    m_gotoAct = act(QKeySequence(QStringLiteral("Ctrl+G")), &MainWindow::goToLine);

    m_wrapAct = new QAction(this);
    m_wrapAct->setCheckable(true);
    m_wrapAct->setShortcut(QKeySequence(QStringLiteral("Alt+Z")));
    connect(m_wrapAct, &QAction::toggled, this, [this](bool on) {
        m_editor->setWordWrap(on);
        App::settings().setValue(QStringLiteral("view/wordWrap"), on);
    });
    m_lineNumbersAct = new QAction(this);
    m_lineNumbersAct->setCheckable(true);
    connect(m_lineNumbersAct, &QAction::toggled, this, [this](bool on) {
        m_editor->setLineNumbersVisible(on);
        App::settings().setValue(QStringLiteral("view/lineNumbers"), on);
    });
    m_zoomInAct = new QAction(this);
    m_zoomInAct->setShortcuts({QKeySequence::ZoomIn, QKeySequence(QStringLiteral("Ctrl+="))});
    connect(m_zoomInAct, &QAction::triggered, this, [this] { m_editor->zoomBy(1); });
    m_zoomOutAct = new QAction(this);
    m_zoomOutAct->setShortcut(QKeySequence::ZoomOut);
    connect(m_zoomOutAct, &QAction::triggered, this, [this] { m_editor->zoomBy(-1); });
    m_zoomResetAct = new QAction(this);
    m_zoomResetAct->setShortcut(QKeySequence(QStringLiteral("Ctrl+0")));
    connect(m_zoomResetAct, &QAction::triggered, this, [this] { m_editor->resetZoom(); });

    m_themeGroup = new QActionGroup(this);
    m_themeSystemAct = new QAction(m_themeGroup);
    m_themeLightAct = new QAction(m_themeGroup);
    m_themeDarkAct = new QAction(m_themeGroup);
    for (QAction* a : {m_themeSystemAct, m_themeLightAct, m_themeDarkAct})
        a->setCheckable(true);
    connect(m_themeGroup, &QActionGroup::triggered, this, [this](QAction* a) {
        App::setThemeMode(a == m_themeLightAct ? App::ThemeMode::Light
                          : a == m_themeDarkAct ? App::ThemeMode::Dark : App::ThemeMode::System);
        for (MainWindow* mw : instances())
            if (!mw->m_host)
                mw->applyTheme();
    });

    m_uiLangGroup = new QActionGroup(this);
    m_uiLangSystemAct = new QAction(m_uiLangGroup);
    m_uiLangFrAct = new QAction(QStringLiteral("Français"), m_uiLangGroup);
    m_uiLangEnAct = new QAction(QStringLiteral("English"), m_uiLangGroup);
    for (QAction* a : {m_uiLangSystemAct, m_uiLangFrAct, m_uiLangEnAct})
        a->setCheckable(true);
    connect(m_uiLangGroup, &QActionGroup::triggered, this, [this](QAction* a) {
        App::setUiLanguagePreference(a == m_uiLangFrAct ? QStringLiteral("fr")
                                     : a == m_uiLangEnAct ? QStringLiteral("en") : QStringLiteral("system"));
        App::installTranslators(App::resolvedUiLanguage());   // déclenche LanguageChange
    });

    m_eolGroup = new QActionGroup(this);
    for (TextIO::Eol e : {TextIO::Eol::LF, TextIO::Eol::CRLF, TextIO::Eol::CR}) {
        auto* a = new QAction(m_eolGroup);
        a->setCheckable(true);
        a->setData(int(e));
    }
    connect(m_eolGroup, &QActionGroup::triggered, this, [this](QAction* a) { setEol(TextIO::Eol(a->data().toInt())); });

    m_encodingGroup = new QActionGroup(this);
    for (TextIO::Encoding e : {TextIO::Encoding::Utf8, TextIO::Encoding::Utf8Bom, TextIO::Encoding::Utf16LE,
                               TextIO::Encoding::Utf16BE, TextIO::Encoding::Latin1, TextIO::Encoding::Windows1252}) {
        auto* a = new QAction(TextIO::encodingName(e), m_encodingGroup);
        a->setCheckable(true);
        a->setData(int(e));
    }
    connect(m_encodingGroup, &QActionGroup::triggered, this,
            [this](QAction* a) { setEncoding(TextIO::Encoding(a->data().toInt())); });

    m_syntaxGroup = new QActionGroup(this);
    {
        auto* a = new QAction(m_syntaxGroup);
        a->setCheckable(true);
        a->setData(-1);
        for (Highlighter::Language l : {Highlighter::Language::None, Highlighter::Language::Json,
                                        Highlighter::Language::Xml, Highlighter::Language::Yaml,
                                        Highlighter::Language::Markdown, Highlighter::Language::Ini}) {
            auto* la = new QAction(m_syntaxGroup);
            la->setCheckable(true);
            la->setData(int(l));
        }
    }
    connect(m_syntaxGroup, &QActionGroup::triggered, this, [this](QAction* a) { setLanguage(a->data().toInt()); });

    m_aboutAct = act(QKeySequence(), &MainWindow::about);
    m_licensesAct = act(QKeySequence(), &MainWindow::showLicenses);
}

void MainWindow::createMenus()
{
    m_fileMenu = menuBar()->addMenu(QString());
    m_fileMenu->addAction(m_newAct);
    m_fileMenu->addAction(m_newWindowAct);
    m_fileMenu->addAction(m_openAct);
    m_recentMenu = m_fileMenu->addMenu(QString());
    m_fileMenu->addSeparator();
    m_fileMenu->addAction(m_saveAct);
    m_fileMenu->addAction(m_saveAsAct);
    m_fileMenu->addAction(m_reloadAct);
    m_fileMenu->addSeparator();
    m_fileMenu->addAction(m_printAct);
    m_fileMenu->addAction(m_openWriterAct);
    m_fileMenu->addSeparator();
    m_fileMenu->addAction(m_closeAct);
    if (!m_host)    // intégré : l'hôte (AuxiNux Office) gère la fermeture de l'application
        m_fileMenu->addAction(m_quitAct);

    m_editMenu = menuBar()->addMenu(QString());
    m_editMenu->addAction(m_undoAct);
    m_editMenu->addAction(m_redoAct);
    m_editMenu->addSeparator();
    m_editMenu->addAction(m_cutAct);
    m_editMenu->addAction(m_copyAct);
    m_editMenu->addAction(m_pasteAct);
    m_editMenu->addAction(m_selectAllAct);
    m_editMenu->addSeparator();
    m_editMenu->addAction(m_findAct);
    m_editMenu->addAction(m_findNextAct);
    m_editMenu->addAction(m_findPrevAct);
    m_editMenu->addAction(m_replaceAct);
    m_editMenu->addAction(m_gotoAct);

    m_viewMenu = menuBar()->addMenu(QString());
    m_viewMenu->addAction(m_wrapAct);
    m_viewMenu->addAction(m_lineNumbersAct);
    m_syntaxMenu = m_viewMenu->addMenu(QString());
    m_syntaxMenu->addActions(m_syntaxGroup->actions());
    m_viewMenu->addSeparator();
    m_viewMenu->addAction(m_zoomInAct);
    m_viewMenu->addAction(m_zoomOutAct);
    m_viewMenu->addAction(m_zoomResetAct);
    m_themeMenu = new QMenu(this);
    m_themeMenu->addActions(m_themeGroup->actions());
    m_uiLangMenu = new QMenu(this);
    m_uiLangMenu->addActions(m_uiLangGroup->actions());
    if (!m_host) {  // intégré : thème et langue d'AuxiNux Office
        m_viewMenu->addSeparator();
        m_viewMenu->addMenu(m_themeMenu);
        m_viewMenu->addMenu(m_uiLangMenu);
    }

    m_documentMenu = menuBar()->addMenu(QString());
    m_eolMenu = m_documentMenu->addMenu(QString());
    m_eolMenu->addActions(m_eolGroup->actions());
    m_encodingMenu = m_documentMenu->addMenu(QString());
    m_encodingMenu->addActions(m_encodingGroup->actions());

    m_helpMenu = menuBar()->addMenu(QString());
    m_helpMenu->addAction(m_aboutAct);
    m_helpMenu->addAction(m_licensesAct);
}

void MainWindow::createStatusBar()
{
    m_posLabel = new QLabel(this);
    m_langLabel = new QLabel(this);
    m_encodingLabel = new QLabel(this);
    m_eolLabel = new QLabel(this);
    for (QLabel* l : {m_posLabel, m_langLabel, m_encodingLabel, m_eolLabel}) {
        l->setContentsMargins(8, 0, 8, 0);
        statusBar()->addPermanentWidget(l);
    }
}

void MainWindow::retranslate()
{
    m_fileMenu->setTitle(tr("&File"));
    m_newAct->setText(tr("&New"));
    m_newWindowAct->setText(m_host ? tr("New &Tab") : tr("New &Window"));
    m_openAct->setText(tr("&Open…"));
    m_recentMenu->setTitle(tr("Recent &Files"));
    m_saveAct->setText(tr("&Save"));
    m_saveAsAct->setText(tr("Save &As…"));
    m_reloadAct->setText(tr("Re&load from Disk"));
    m_printAct->setText(tr("&Print…"));
    m_openWriterAct->setText(tr("Open in Aux&iWriter"));
    m_closeAct->setText(tr("&Close"));
    m_quitAct->setText(tr("&Quit"));

    m_editMenu->setTitle(tr("&Edit"));
    m_undoAct->setText(tr("&Undo"));
    m_redoAct->setText(tr("&Redo"));
    m_cutAct->setText(tr("Cu&t"));
    m_copyAct->setText(tr("&Copy"));
    m_pasteAct->setText(tr("&Paste"));
    m_selectAllAct->setText(tr("Select &All"));
    m_findAct->setText(tr("&Find…"));
    m_findNextAct->setText(tr("Find &Next"));
    m_findPrevAct->setText(tr("Find Pre&vious"));
    m_replaceAct->setText(tr("&Replace…"));
    m_gotoAct->setText(tr("&Go to Line…"));

    m_viewMenu->setTitle(tr("&View"));
    m_wrapAct->setText(tr("&Word Wrap"));
    m_lineNumbersAct->setText(tr("&Line Numbers"));
    m_syntaxMenu->setTitle(tr("&Syntax Highlighting"));
    const QList<QAction*> syntax = m_syntaxGroup->actions();
    syntax[0]->setText(tr("Automatic (from file extension)"));
    for (int i = 1; i < syntax.size(); ++i)
        syntax[i]->setText(Highlighter::languageName(Highlighter::Language(syntax[i]->data().toInt())));
    m_zoomInAct->setText(tr("Zoom &In"));
    m_zoomOutAct->setText(tr("Zoom &Out"));
    m_zoomResetAct->setText(tr("&Reset Zoom"));
    m_themeMenu->setTitle(tr("&Theme"));
    m_themeSystemAct->setText(tr("Follow &System"));
    m_themeLightAct->setText(tr("&Light"));
    m_themeDarkAct->setText(tr("&Dark"));
    m_uiLangMenu->setTitle(tr("Interface &Language"));
    m_uiLangSystemAct->setText(tr("Same as AuxiNux Office / system"));

    m_documentMenu->setTitle(tr("&Document"));
    m_eolMenu->setTitle(tr("&Line Endings"));
    const QList<QAction*> eols = m_eolGroup->actions();
    eols[0]->setText(tr("LF (Linux, macOS)"));
    eols[1]->setText(tr("CRLF (Windows)"));
    eols[2]->setText(tr("CR (classic Mac OS)"));
    m_encodingMenu->setTitle(tr("&Encoding"));

    m_helpMenu->setTitle(tr("&Help"));
    m_aboutAct->setText(tr("&About AuxiText"));
    m_licensesAct->setText(tr("Free Software and &Licenses"));

    if (m_find)
        m_find->retranslate();
    updateTitle();
    updateStatus();
    updateRecentMenu();
}

void MainWindow::changeEvent(QEvent* event)
{
    if (event->type() == QEvent::LanguageChange)
        retranslate();
    QMainWindow::changeEvent(event);
}

void MainWindow::readSettings()
{
    QSettings& s = App::settings();
    const bool wrap = s.value(QStringLiteral("view/wordWrap"), true).toBool();
    const bool numbers = s.value(QStringLiteral("view/lineNumbers"), true).toBool();
    m_wrapAct->setChecked(wrap);
    m_editor->setWordWrap(wrap);
    m_lineNumbersAct->setChecked(numbers);
    m_editor->setLineNumbersVisible(numbers);
    if (!m_host) {
        const QByteArray geometry = s.value(QStringLiteral("window/geometry")).toByteArray();
        if (geometry.isEmpty() || !restoreGeometry(geometry))
            resize(980, 700);
    }

    switch (App::themeMode()) {
    case App::ThemeMode::Light: m_themeLightAct->setChecked(true); break;
    case App::ThemeMode::Dark: m_themeDarkAct->setChecked(true); break;
    case App::ThemeMode::System: m_themeSystemAct->setChecked(true); break;
    }
    const QString lang = App::uiLanguagePreference();
    (lang == QLatin1String("fr") ? m_uiLangFrAct : lang == QLatin1String("en") ? m_uiLangEnAct : m_uiLangSystemAct)
        ->setChecked(true);
}

void MainWindow::writeSettings()
{
    if (!m_host)
        App::settings().setValue(QStringLiteral("window/geometry"), saveGeometry());
}

void MainWindow::applyTheme()
{
    const bool dark = App::isDark();
    App::applyPalette(dark);
    m_editor->setDark(dark);
    m_highlighter->setDarkPalette(dark);
}

// ---------------------------------------------------------------------------
// Fichiers
// ---------------------------------------------------------------------------

void MainWindow::newFile()
{
    if (!maybeSave())
        return;
    m_editor->clear();
    m_encoding = TextIO::Encoding::Utf8;
    m_eol = TextIO::platformEol();
    setCurrentFile(QString());
}

void MainWindow::open()
{
    const QString dir = m_path.isEmpty()
                            ? App::settings().value(QStringLiteral("files/lastDir"), QDir::homePath()).toString()
                            : QFileInfo(m_path).absolutePath();
    const QString filter = tr("Text files") + QStringLiteral(
        " (*.txt *.log *.md *.markdown *.csv *.json *.xml *.yaml *.yml *.ini *.conf *.cfg);;")
        + tr("All files") + QStringLiteral(" (*)");
    const QStringList files = QFileDialog::getOpenFileNames(this, tr("Open"), dir, filter);
    for (const QString& f : files) {
        if (isUntitledAndEmpty())
            openFile(f);
        else
            openElsewhere(f);
    }
}

bool MainWindow::openFile(const QString& path)
{
    QFileInfo info(path);
    if (!info.exists()) {
        // Nouveau fichier à cet emplacement (comme « auxitext notes.txt » sur un fichier absent)
        m_editor->clear();
        m_encoding = TextIO::Encoding::Utf8;
        m_eol = TextIO::platformEol();
        setCurrentFile(info.absoluteFilePath());
        m_editor->document()->setModified(false);
        statusBar()->showMessage(tr("New file: %1").arg(info.fileName()), 5000);
        return true;
    }
    if (info.isDir()) {
        QMessageBox::warning(this, tr("Open"), tr("“%1” is a folder.").arg(QDir::toNativeSeparators(path)));
        return false;
    }
    if (info.size() > kLargeFile
        && QMessageBox::question(this, tr("Large file"),
                                 tr("“%1” is %2 MB. Opening it may be slow. Continue?")
                                     .arg(info.fileName()).arg(info.size() / (1024 * 1024)))
               != QMessageBox::Yes) {
        return false;
    }
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) {
        QMessageBox::warning(this, tr("Open"),
                             tr("Cannot read “%1”:\n%2").arg(QDir::toNativeSeparators(path), file.errorString()));
        return false;
    }
    const QByteArray raw = file.readAll();
    file.close();
    QApplication::setOverrideCursor(Qt::WaitCursor);
    const TextIO::Document doc = TextIO::decode(raw);
    m_editor->setPlainText(doc.text);
    QApplication::restoreOverrideCursor();
    m_encoding = doc.encoding;
    m_eol = doc.eol;
    m_languageOverride = -1;
    setCurrentFile(info.absoluteFilePath());
    addRecent(info.absoluteFilePath());
    App::settings().setValue(QStringLiteral("files/lastDir"), info.absolutePath());
    if (doc.hadInvalidUtf8)
        statusBar()->showMessage(tr("This file is not valid UTF-8: it was opened as %1.")
                                     .arg(TextIO::encodingName(doc.encoding)), 8000);
    else if (doc.eolStats.mixed())
        statusBar()->showMessage(tr("Mixed line endings detected; they will be saved as %1.")
                                     .arg(TextIO::eolName(doc.eol)), 8000);
    return true;
}

bool MainWindow::save()
{
    if (m_path.isEmpty())
        return saveAs();
    return saveTo(m_path);
}

bool MainWindow::saveAs()
{
    QString suggestion = m_path;
    if (suggestion.isEmpty())
        suggestion = App::settings().value(QStringLiteral("files/lastDir"), QDir::homePath()).toString()
                     + QLatin1Char('/') + tr("Untitled") + QStringLiteral(".txt");
    const QString filter = tr("Text files") + QStringLiteral(" (*.txt);;Markdown (*.md);;JSON (*.json);;XML (*.xml);;YAML (*.yaml *.yml);;INI (*.ini *.conf);;")
                           + tr("All files") + QStringLiteral(" (*)");
    const QString path = QFileDialog::getSaveFileName(this, tr("Save As"), suggestion, filter);
    if (path.isEmpty())
        return false;
    return saveTo(path);
}

bool MainWindow::saveTo(const QString& path)
{
    const QString text = m_editor->toPlainText();
    if (!TextIO::canEncodeLosslessly(text, m_encoding)) {
        const auto answer = QMessageBox::warning(
            this, tr("Save"),
            tr("Some characters cannot be represented in %1 and would be lost.\nSave as UTF-8 instead?")
                .arg(TextIO::encodingName(m_encoding)),
            QMessageBox::Yes | QMessageBox::No | QMessageBox::Cancel, QMessageBox::Yes);
        if (answer == QMessageBox::Cancel)
            return false;
        if (answer == QMessageBox::Yes)
            m_encoding = TextIO::Encoding::Utf8;
    }
    QSaveFile file(path);   // écriture atomique : pas de fichier tronqué en cas d'erreur
    if (!file.open(QIODevice::WriteOnly)) {
        QMessageBox::warning(this, tr("Save"),
                             tr("Cannot write “%1”:\n%2").arg(QDir::toNativeSeparators(path), file.errorString()));
        return false;
    }
    file.write(TextIO::encode(text, m_encoding, m_eol));
    m_ignoreNextChange = true;
    if (!file.commit()) {
        m_ignoreNextChange = false;
        QMessageBox::warning(this, tr("Save"),
                             tr("Cannot write “%1”:\n%2").arg(QDir::toNativeSeparators(path), file.errorString()));
        return false;
    }
    const bool renamed = path != m_path;
    m_editor->document()->setModified(false);
    setCurrentFile(QFileInfo(path).absoluteFilePath());
    if (renamed) {
        m_languageOverride = -1;
        setLanguage(-1);
    }
    addRecent(m_path);
    App::settings().setValue(QStringLiteral("files/lastDir"), QFileInfo(path).absolutePath());
    statusBar()->showMessage(tr("Saved: %1").arg(QDir::toNativeSeparators(m_path)), 4000);
    return true;
}

void MainWindow::reload()
{
    if (m_path.isEmpty() || !QFileInfo::exists(m_path))
        return;
    if (m_editor->document()->isModified()
        && QMessageBox::question(this, tr("Reload"), tr("Discard your changes and reload the file from disk?"))
               != QMessageBox::Yes)
        return;
    const QTextCursor cursor = m_editor->textCursor();
    const int pos = cursor.position();
    openFile(m_path);
    QTextCursor c = m_editor->textCursor();
    c.setPosition(qMin(pos, m_editor->document()->characterCount() - 1));
    m_editor->setTextCursor(c);
}

void MainWindow::print()
{
#ifndef QT_NO_PRINTER
    QPrinter printer(QPrinter::HighResolution);
    printer.setDocName(m_path.isEmpty() ? tr("Untitled") : QFileInfo(m_path).fileName());
    QPrintDialog dialog(&printer, this);
    if (m_editor->textCursor().hasSelection())
        dialog.setOption(QAbstractPrintDialog::PrintSelection);
    if (dialog.exec() == QDialog::Accepted)
        m_editor->print(&printer);
#endif
}

void MainWindow::openInWriter()
{
    if (m_path.isEmpty() || m_editor->document()->isModified()) {
        if (QMessageBox::question(this, tr("Open in AuxiWriter"),
                                  tr("The document must be saved first. Save now?")) != QMessageBox::Yes
            || !save())
            return;
    }
#ifdef Q_OS_MACOS
    // L'éditeur AuxiWriter de macOS renvoie les fichiers texte à AuxiText ; cette marque
    // (empreinte du chemin, heure) lui indique que l'utilisateur veut AuxiWriter pour ce fichier.
    App::markOpenInWriter(m_path);
#endif
    const QString writer = App::writerExecutable();
    if (!QFileInfo::exists(writer)
        || !QProcess::startDetached(writer, App::writerArguments(m_path))) {
        QMessageBox::warning(this, tr("Open in AuxiWriter"), tr("AuxiNux Office could not be started."));
    }
}

void MainWindow::goToLine()
{
    bool ok = false;
    const int line = QInputDialog::getInt(this, tr("Go to Line"),
                                          tr("Line number (1 – %1):").arg(m_editor->blockCount()),
                                          m_editor->textCursor().blockNumber() + 1, 1,
                                          qMax(1, m_editor->blockCount()), 1, &ok);
    if (ok)
        m_editor->goToLine(line);
}

bool MainWindow::maybeSave()
{
    if (!m_editor->document()->isModified())
        return true;
    const QString name = m_path.isEmpty() ? tr("Untitled") : QFileInfo(m_path).fileName();
    const auto answer = QMessageBox::warning(
        this, tr("AuxiText"), tr("Do you want to save the changes made to “%1”?").arg(name),
        QMessageBox::Save | QMessageBox::Discard | QMessageBox::Cancel, QMessageBox::Save);
    if (answer == QMessageBox::Save)
        return save();
    return answer == QMessageBox::Discard;
}

void MainWindow::setCurrentFile(const QString& path)
{
    if (!m_path.isEmpty())
        m_watcher->removePath(m_path);
    m_path = path;
    if (!m_path.isEmpty() && QFileInfo::exists(m_path))
        m_watcher->addPath(m_path);
    m_editor->document()->setModified(false);
    if (m_languageOverride < 0)
        m_highlighter->setLanguage(Highlighter::languageForFile(m_path));
    updateTitle();
    updateStatus();
}

void MainWindow::updateTitle()
{
    const QString name = m_path.isEmpty() ? tr("Untitled") : QFileInfo(m_path).fileName();
    setWindowTitle(QStringLiteral("%1%2 — AuxiText").arg(m_editor->document()->isModified() ? QStringLiteral("*") : QString(), name));
    setWindowFilePath(m_path);
    if (m_host)
        m_host->editorStateChanged(this);
}

void MainWindow::updateStatus()
{
    const QTextCursor c = m_editor->textCursor();
    m_posLabel->setText(tr("Ln %1, Col %2").arg(c.blockNumber() + 1).arg(c.positionInBlock() + 1));
    m_encodingLabel->setText(TextIO::encodingName(m_encoding));
    m_eolLabel->setText(TextIO::eolName(m_eol));
    m_langLabel->setText(Highlighter::languageName(m_highlighter->language()));
    for (QAction* a : m_eolGroup->actions())
        a->setChecked(a->data().toInt() == int(m_eol));
    for (QAction* a : m_encodingGroup->actions())
        a->setChecked(a->data().toInt() == int(m_encoding));
    for (QAction* a : m_syntaxGroup->actions())
        a->setChecked(a->data().toInt() == m_languageOverride
                      || (m_languageOverride >= 0 ? false : a->data().toInt() == -1));
}

void MainWindow::setEncoding(TextIO::Encoding encoding)
{
    if (m_encoding == encoding)
        return;
    m_encoding = encoding;
    m_editor->document()->setModified(true);
    updateStatus();
}

void MainWindow::setEol(TextIO::Eol eol)
{
    if (m_eol == eol)
        return;
    m_eol = eol;
    m_editor->document()->setModified(true);
    updateStatus();
}

void MainWindow::setLanguage(int language)
{
    m_languageOverride = language;
    m_highlighter->setLanguage(language < 0 ? Highlighter::languageForFile(m_path)
                                            : Highlighter::Language(language));
    updateStatus();
}

void MainWindow::onFileChangedOnDisk(const QString& path)
{
    if (path != m_path)
        return;
    if (m_ignoreNextChange) {
        m_ignoreNextChange = false;
        if (QFileInfo::exists(m_path) && !m_watcher->files().contains(m_path))
            m_watcher->addPath(m_path);
        return;
    }
    // Certains éditeurs remplacent le fichier : on se réabonne après un court délai.
    QTimer::singleShot(200, this, [this] {
        if (QFileInfo::exists(m_path) && !m_watcher->files().contains(m_path))
            m_watcher->addPath(m_path);
        if (!QFileInfo::exists(m_path)) {
            statusBar()->showMessage(tr("The file was deleted or moved on disk."), 8000);
            m_editor->document()->setModified(true);
            return;
        }
        if (!m_editor->document()->isModified()) {
            reload();
            statusBar()->showMessage(tr("File reloaded (modified by another program)."), 5000);
        } else if (QMessageBox::question(this, tr("File changed"),
                                         tr("“%1” was modified by another program.\nReload it and lose your changes?")
                                             .arg(QFileInfo(m_path).fileName())) == QMessageBox::Yes) {
            m_editor->document()->setModified(false);
            reload();
        }
    });
}

// ---------------------------------------------------------------------------
// Récents, aide, événements
// ---------------------------------------------------------------------------

void MainWindow::addRecent(const QString& path)
{
    QStringList recent = App::settings().value(QStringLiteral("files/recent")).toStringList();
    recent.removeAll(path);
    recent.prepend(path);
    while (recent.size() > kMaxRecent)
        recent.removeLast();
    App::settings().setValue(QStringLiteral("files/recent"), recent);
    for (MainWindow* mw : instances())
        mw->updateRecentMenu();
}

void MainWindow::updateRecentMenu()
{
    m_recentMenu->clear();
    const QStringList recent = App::settings().value(QStringLiteral("files/recent")).toStringList();
    for (const QString& path : recent) {
        QAction* a = m_recentMenu->addAction(QDir::toNativeSeparators(path));
        connect(a, &QAction::triggered, this, [this, path] {
            if (isUntitledAndEmpty())
                openFile(path);
            else
                openElsewhere(path);
        });
    }
    if (!recent.isEmpty()) {
        m_recentMenu->addSeparator();
        QAction* clear = m_recentMenu->addAction(tr("Clear List"));
        connect(clear, &QAction::triggered, this, [this] {
            App::settings().remove(QStringLiteral("files/recent"));
            updateRecentMenu();
        });
    }
    m_recentMenu->setEnabled(!recent.isEmpty());
}

void MainWindow::about()
{
    QMessageBox box(this);
    box.setWindowTitle(tr("About AuxiText"));
    box.setIconPixmap(windowIcon().pixmap(64, 64));
    box.setTextFormat(Qt::RichText);
    box.setText(tr("<h3>AuxiText %1</h3>"
                   "<p>Lightweight plain text editor of <b>AuxiNux Office</b>.</p>"
                   "<p>Free software developed by the AuxiNux project, licensed under the "
                   "GNU Affero General Public License v3.</p>"
                   "<p>No telemetry, no account, works offline.</p>"
                   "<p><a href=\"https://office.auxinux.ca\">office.auxinux.ca</a></p>").arg(App::version()));
    box.exec();
}

void MainWindow::showLicenses()
{
    const QString index = App::licensesIndex();
    if (QFileInfo::exists(index))
        QDesktopServices::openUrl(QUrl::fromLocalFile(index));
    else
        QMessageBox::information(this, tr("Free Software and Licenses"),
                                 tr("AuxiText is free software (GNU AGPL v3). It uses the Qt toolkit "
                                    "(GNU LGPL v3). The license texts are installed with AuxiNux Office."));
}

void MainWindow::closeEvent(QCloseEvent* event)
{
    if (maybeSave()) {
        writeSettings();
        event->accept();
    } else {
        event->ignore();
    }
}

void MainWindow::dragEnterEvent(QDragEnterEvent* event)
{
    if (event->mimeData()->hasUrls())
        event->acceptProposedAction();
}

void MainWindow::dropEvent(QDropEvent* event)
{
    for (const QUrl& url : event->mimeData()->urls()) {
        if (!url.isLocalFile())
            continue;
        if (isUntitledAndEmpty())
            openFile(url.toLocalFile());
        else
            MainWindow::openInNewWindow(url.toLocalFile());
    }
    event->acceptProposedAction();
}
