/*
 * AuxiText — éditeur de texte brut d'AuxiNux Office
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

#include "app.h"
#include "mainwindow.h"

#include <QApplication>
#include <QDir>
#ifdef Q_OS_LINUX
# include <climits>
# include <cstdlib>
# include <cstring>
# include <string>
# include <unistd.h>
#endif
#include <QFileInfo>
#include <QFileOpenEvent>
#include <QIcon>
#include <QTimer>
#include <QStyleFactory>
#include <QUrl>

static const char* kHelp =
    "Usage: auxitext [options] [fichier...]\n"
    "\n"
    "Éditeur de texte brut d'AuxiNux Office.\n"
    "\n"
    "Options :\n"
    "  --version     affiche la version et quitte\n"
    "  --help        affiche cette aide et quitte\n"
    "  --new         ouvre un nouveau document vide (par défaut sans fichier)\n";

#ifdef Q_OS_LINUX
// Les plugins Qt livrés par upstream (platforms/, imageformats/…) cherchent les
// bibliothèques Qt dans ../../lib : comme le lanceur auxioffice, on place le
// répertoire d'installation en tête de LD_LIBRARY_PATH (une seule relance).
static void ensureBundledLibraryPath(char* argv[])
{
    if (getenv("AUXITEXT_ENV_READY"))
        return;
    char exe[PATH_MAX];
    const ssize_t n = readlink("/proc/self/exe", exe, sizeof(exe) - 1);
    if (n <= 0)
        return;
    exe[n] = '\0';
    std::string dir(exe);
    dir = dir.substr(0, dir.rfind('/'));
    const char* current = getenv("LD_LIBRARY_PATH");
    if (current && std::strncmp(current, dir.c_str(), dir.size()) == 0)
        return;
    std::string value = dir;
    if (current && *current)
        value += std::string(":") + current;
    setenv("LD_LIBRARY_PATH", value.c_str(), 1);
    setenv("AUXITEXT_ENV_READY", "1", 1);
    execv(exe, argv);   // en cas d'échec on continue sans relance
}
#endif

#ifdef Q_OS_MACOS
// macOS transmet les fichiers (Finder, « Ouvrir avec ») et les adresses auxitext://new
// (tuile « Nouveau fichier texte » d'AuxiNux Office) par des événements, pas par argv.
class OpenEventFilter : public QObject
{
public:
    int handled = 0;
    bool eventFilter(QObject* obj, QEvent* event) override
    {
        if (event->type() != QEvent::FileOpen)
            return QObject::eventFilter(obj, event);
        const QUrl url = static_cast<QFileOpenEvent*>(event)->url();
        if (url.isLocalFile())
            MainWindow::openInNewWindow(url.toLocalFile());
        else
            MainWindow::openInNewWindow();      // auxitext://new
        ++handled;
        return true;
    }
};
#endif

int main(int argc, char* argv[])
{
    // Options traitées avant QApplication : aucune connexion à l'affichage n'est nécessaire.
    for (int i = 1; i < argc; ++i) {
        const QString arg = QString::fromLocal8Bit(argv[i]);
        if (arg == QLatin1String("--version") || arg == QLatin1String("-v")) {
            App::printToConsole(App::versionLine());
            return 0;
        }
        if (arg == QLatin1String("--help") || arg == QLatin1String("-h")) {
            App::printToConsole(QString::fromUtf8(kHelp));
            return 0;
        }
    }

#ifdef Q_OS_LINUX
    ensureBundledLibraryPath(argv);
#endif
#if QT_VERSION >= QT_VERSION_CHECK(5, 6, 0) && QT_VERSION < QT_VERSION_CHECK(6, 0, 0)
    QApplication::setAttribute(Qt::AA_EnableHighDpiScaling);
    QApplication::setAttribute(Qt::AA_UseHighDpiPixmaps);
#endif
    QApplication app(argc, argv);
    QApplication::setOrganizationName(QStringLiteral("AuxiNux"));
    QApplication::setApplicationName(QStringLiteral("AuxiText"));
    QApplication::setApplicationVersion(App::version());
#if QT_VERSION >= QT_VERSION_CHECK(5, 7, 0)
    QApplication::setDesktopFileName(QStringLiteral("ca.auxinux.AuxiOffice.Text"));
#endif
    QApplication::setWindowIcon(QIcon(QStringLiteral(":/icons/auxitext.png")));
    QApplication::setStyle(QStyleFactory::create(QStringLiteral("Fusion")));
    App::installTranslators(App::resolvedUiLanguage());

    QStringList files;
    const QStringList args = QApplication::arguments().mid(1);
    for (const QString& arg : args) {
        if (arg.startsWith(QLatin1String("--")))
            continue;
        if (arg.startsWith(QLatin1String("file://"), Qt::CaseInsensitive))
            files << QUrl(arg).toLocalFile();
        else
            files << QFileInfo(arg).absoluteFilePath();
    }

    int opened = 0;
    for (const QString& f : files)
        opened += MainWindow::openInNewWindow(f) ? 1 : 0;
#ifdef Q_OS_MACOS
    static OpenEventFilter openEvents;
    app.installEventFilter(&openEvents);
    // Les événements d'ouverture arrivent juste après le démarrage : fenêtre vide seulement s'il n'y en a pas.
    if (opened == 0)
        QTimer::singleShot(400, [] { if (openEvents.handled == 0) MainWindow::openInNewWindow(); });
#else
    if (opened == 0)
        MainWindow::openInNewWindow();
#endif

    return app.exec();
}
