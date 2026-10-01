/*
 * AuxiNux Office — extensions du shell natif (desktop-apps/win-linux).
 *
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

#include "auxinux/auxinux.h"
#include "auxinux_branding.h"          // généré depuis branding/product.json (src/prop/)

#include "applicationmanager.h"        // CAscApplicationSettings (desktop-sdk)
#include "cascapplicationmanagerwrapper.h"
#include "clangater.h"
#include "components/asctabwidget.h"   // COpenOptions, etLocalFile...
#include "components/cfiledialog.h"
#include "defines.h"
#include "utils.h"

#include <QApplication>
#include <QCoreApplication>
#include <QDir>
#include <QFileInfo>
#include <QHash>
#include <QJsonArray>
#include <QProcess>
#include <QUrl>
#include <QStandardPaths>
#include <QTimer>
#include <QTranslator>
#include <csignal>
#include <cstdio>

#ifdef _WIN32
# include <windows.h>
#endif

namespace AuxiNux {

QString versionLine()
{
    return QStringLiteral(AUXI_PRODUCT_NAME " " AUXI_VERSION);
}

void printVersion()
{
    const QByteArray line = versionLine().toUtf8() + "\n";
#ifdef _WIN32
    // Application GUI : on écrit sur la sortie redirigée si elle existe,
    // sinon sur la console du processus parent (PowerShell, cmd).
    HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
    bool attached = false;
    if ( out == NULL || out == INVALID_HANDLE_VALUE || GetFileType(out) == FILE_TYPE_UNKNOWN ) {
        if ( AttachConsole(ATTACH_PARENT_PROCESS) ) {
            attached = true;
            out = CreateFileW(L"CONOUT$", GENERIC_WRITE, FILE_SHARE_WRITE, NULL, OPEN_EXISTING, 0, NULL);
        }
    }
    if ( out != NULL && out != INVALID_HANDLE_VALUE ) {
        DWORD written = 0;
        WriteFile(out, line.constData(), DWORD(line.size()), &written, NULL);
    }
    if ( attached )
        FreeConsole();
#else
    fwrite(line.constData(), 1, size_t(line.size()), stdout);
    fflush(stdout);
#endif
}

QString cacheDir()
{
#ifdef _WIN32
    return QStandardPaths::writableLocation(QStandardPaths::GenericDataLocation)
            + QStringLiteral("/" AUXI_WIN_VENDOR_DIR "/" AUXI_WIN_APP_DIR "/cache");
#else
    // ~/.cache par défaut, respecte XDG_CACHE_HOME
    return QStandardPaths::writableLocation(QStandardPaths::GenericCacheLocation)
            + QStringLiteral("/" AUXI_XDG_NAME);
#endif
}

QString configFile()
{
#ifdef _WIN32
    QString roaming = QString::fromLocal8Bit(qgetenv("APPDATA"));
    if ( roaming.isEmpty() )
        roaming = QDir::homePath() + QStringLiteral("/AppData/Roaming");
    return QDir::fromNativeSeparators(roaming)
            + QStringLiteral("/" AUXI_WIN_VENDOR_DIR "/" AUXI_WIN_APP_DIR "/settings.ini");
#else
    // Sous Linux la configuration Qt suit déjà XDG : ~/.config/auxioffice/
    return QString();
#endif
}

void adjustSettings(CAscApplicationSettings& settings)
{
    const QString cache = cacheDir();
    QDir().mkpath(cache);
    settings.cache_path = (cache + QStringLiteral("/cef")).toStdWString();

    // Nom d'application écrit par le convertisseur dans les métadonnées des documents
    // (docProps/app.xml...). Transmis à x2t via la variable APPLICATION_NAME.
    settings.converter_application_name = AUXI_DOCUMENT_APPLICATION_NAME;
    settings.converter_application_company = AUXI_DOCUMENT_APPLICATION_COMPANY;
}

void applyPrivacyDefaults()
{
    // settings.xml du moteur est rangé à côté du cache des polices : le dossier doit exister.
    const std::wstring fonts = AscAppManager::getInstance().m_oSettings.fonts_cache_info_path;
    QDir().mkpath(QString::fromStdWString(fonts) + QStringLiteral("/.."));
    QDir().mkpath(QString::fromStdWString(fonts));
#ifdef AUXI_DEFAULT_DISABLE_AI
    if ( AscAppManager::userSettings(L"disable-ai").empty() )
        AscAppManager::setUserSettings(L"disable-ai", L"1");
#endif
}

static QStringList textExtensions()
{
    static const QStringList list = QString::fromLatin1(AUXI_TEXT_EXTENSIONS).split(';', QString::SkipEmptyParts);
    return list;
}

bool isTextDocument(const QString& path)
{
    const QFileInfo info(path);
    const QString suffix = info.suffix().toLower();
    if ( suffix.isEmpty() )
        return false;   // les fichiers sans extension sont ouverts explicitement dans AuxiText
    return textExtensions().contains(suffix);
}

static QString textEditorPath()
{
    return QCoreApplication::applicationDirPath() + QStringLiteral("/" AUXI_TEXT_EDITOR_BINARY);
}

bool launchTextEditor(const QStringList& files)
{
    const QString exe = textEditorPath();
    if ( !QFileInfo(exe).exists() )
        return false;
    return QProcess::startDetached(exe, files, QDir::homePath());
}

bool routeToTextEditor(const COpenOptions& opts)
{
    if ( !(opts.srctype == etLocalFile || opts.srctype == etRecentFile) )
        return false;

    QString path = !opts.wurl.empty() ? QString::fromStdWString(opts.wurl) : opts.url;
    if ( path.startsWith(QStringLiteral("file://"), Qt::CaseInsensitive) )
        path = QUrl(path).toLocalFile();
    if ( path.isEmpty() || !QFileInfo(path).isFile() || !isTextDocument(path) )
        return false;

    return launchTextEditor(QStringList{path});
}

namespace {
// Messages ajoutés par AuxiNux au shell (absents des traductions upstream de desktop-apps).
class Translator : public QTranslator
{
public:
    QString translate(const char *, const char *source, const char *, int) const override
    {
        if ( !CLangater::getCurrentLangCode().startsWith(QStringLiteral("fr")) )
            return QString();
        static const QHash<QByteArray, QString> fr = {
            {"AuxiText cannot be started.", QString::fromUtf8("AuxiText ne peut pas être lancé.")},
            {"PDF documents", QStringLiteral("Documents PDF")},
            {"All files (*.*)", QStringLiteral("Tous les fichiers (*.*)")},
        };
        return fr.value(QByteArray(source));
    }
    bool isEmpty() const override { return false; }
};
}

#ifdef __linux
namespace {
// Le moteur (desktop-sdk, CLinuxData::Check) installe au démarrage de la boucle d'événements un
// gestionnaire SIGTERM qui ferme l'application depuis le gestionnaire de signal (opérations non
// réentrantes) : il se termine par une erreur de segmentation, donc un core dump à chaque
// fermeture de session. Dès qu'il est en place, on rétablit l'action par défaut d'Unix
// (terminaison immédiate, sans core dump ; les processus du moteur web s'arrêtent avec le shell).
void restoreSigterm(int attempts)
{
    struct sigaction current;
    if ( sigaction(SIGTERM, nullptr, &current) == 0 && current.sa_handler != SIG_DFL ) {
        std::signal(SIGTERM, SIG_DFL);
        return;
    }
    if ( attempts > 0 )
        QTimer::singleShot(500, [attempts] { restoreSigterm(attempts - 1); });
}
}

void restoreDefaultSignals()
{
    QTimer::singleShot(0, [] { restoreSigterm(20); });
}
#endif

void installTranslator()
{
    static Translator translator;
    QCoreApplication::installTranslator(&translator);
}

QString selectPdfFile(int parentViewId)
{
    ParentHandle parent = !(parentViewId < 0) ? AscAppManager::windowHandleFromId(parentViewId)
                                               : QApplication::activeWindow();
    CFileDialogWrapper dialog(parent);
    QString selected;
    const QString filter = QObject::tr("PDF documents") + QStringLiteral(" (*.pdf *.PDF);;")
                           + QObject::tr("All files (*.*)");
    const QStringList files = dialog.modalOpen(Utils::lastPath(LOCAL_PATH_OPEN), filter, &selected, false);
    if ( files.isEmpty() )
        return QString();
    Utils::keepLastPath(LOCAL_PATH_OPEN, QFileInfo(files.first()).absolutePath());
    return files.first();
}

void extendAboutInfo(QJsonObject& about)
{
    const QString appdir = QCoreApplication::applicationDirPath();
    about["appname"]  = QStringLiteral(AUXI_PRODUCT_NAME);
    about["version"]  = QStringLiteral(AUXI_VERSION);
    about["rights"]   = QStringLiteral(AUXI_COPYRIGHT);
    about["link"]     = QStringLiteral(AUXI_WEBSITE);
    about["site"]     = QStringLiteral(AUXI_WEBSITE_LABEL);
    about["commercial"] = false;

    // Mentions exigées par les « Additional Terms » de la licence upstream (AGPLv3 §5 et §7) :
    // développeur d'origine, version modifiée (avec dates), accès aux licences.
    QJsonObject legal;
    legal["upstream_name"]      = QStringLiteral(AUXI_UPSTREAM_NAME);
    legal["upstream_version"]   = QStringLiteral(AUXI_UPSTREAM_VERSION);
    legal["upstream_developer"] = QStringLiteral(AUXI_UPSTREAM_DEVELOPER);
    legal["upstream_url"]       = QStringLiteral(AUXI_UPSTREAM_URL);
    legal["modified_since"]     = QStringLiteral(AUXI_MODIFICATION_DATE);
    legal["source_url"]         = QStringLiteral(AUXI_SOURCE_URL);
    legal["license_file"]       = QUrl::fromLocalFile(appdir + QStringLiteral("/LICENSE.txt")).toString();
    legal["notice_file"]        = QUrl::fromLocalFile(appdir + QStringLiteral("/NOTICE.txt")).toString();
    legal["thirdparty_file"]    = QUrl::fromLocalFile(appdir + QStringLiteral("/licenses/index.html")).toString();
    about["auxinux"] = legal;
}

}
