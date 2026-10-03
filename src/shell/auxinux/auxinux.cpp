/*
 * AuxiNux Office — extensions du shell natif (desktop-apps/win-linux).
 *
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

#include "auxinux/auxinux.h"
#include "auxinux/texttabs.h"
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
#include <cstdlib>
#include <string>
#include <vector>

#ifdef _WIN32
# include <windows.h>
# include <shellapi.h>
#else
# include <unistd.h>
#endif

namespace AuxiNux {

namespace {
const char DISABLE_FEATURES[] = "--disable-features=";
const char RELAUNCH_MARK[] = "AUXI_ENGINE_SWITCHES_RELAUNCH";

std::vector<std::string> split(const std::string& text, char sep)
{
    std::vector<std::string> out;
    std::string::size_type start = 0, end;
    while ( (end = text.find(sep, start)) != std::string::npos ) {
        if ( end > start )
            out.push_back(text.substr(start, end - start));
        start = end + 1;
    }
    if ( start < text.size() )
        out.push_back(text.substr(start));
    return out;
}

bool startsWith(const std::string& text, const char* prefix)
{
    return text.compare(0, std::char_traits<char>::length(prefix), prefix) == 0;
}

// Les commutateurs sont-ils tous présents ? Pour --disable-features, Chromium ne retient que la
// dernière occurrence : elle doit contenir toutes les fonctions désactivées par AuxiNux.
bool hasEngineSwitches(const std::vector<std::string>& args)
{
    const size_t prefix = std::char_traits<char>::length(DISABLE_FEATURES);
    for ( const std::string& wanted : split(AUXI_ENGINE_SWITCHES, ';') ) {
        if ( startsWith(wanted, DISABLE_FEATURES) ) {
            std::string last;
            bool found = false;
            for ( const std::string& a : args )
                if ( startsWith(a, DISABLE_FEATURES) ) {
                    last = a.substr(prefix);
                    found = true;
                }
            if ( !found )
                return false;
            const std::vector<std::string> have = split(last, ',');
            for ( const std::string& feature : split(wanted.substr(prefix), ',') ) {
                bool present = false;
                for ( const std::string& h : have )
                    present = present || h == feature;
                if ( !present )
                    return false;
            }
        } else {
            bool present = false;
            for ( const std::string& a : args )
                present = present || a == wanted;
            if ( !present )
                return false;
        }
    }
    return true;
}

// Arguments du nouveau lancement : commutateurs d'AuxiNux (fonctions désactivées par l'appelant
// fusionnées), puis les arguments d'origine sans leurs --disable-features.
std::vector<std::string> withEngineSwitches(const std::vector<std::string>& args)
{
    const size_t prefix = std::char_traits<char>::length(DISABLE_FEATURES);
    std::string extra;
    for ( const std::string& a : args )
        if ( startsWith(a, DISABLE_FEATURES) && a.size() > prefix )
            extra += "," + a.substr(prefix);
    std::vector<std::string> out;
    for ( const std::string& s : split(AUXI_ENGINE_SWITCHES, ';') )
        out.push_back(startsWith(s, DISABLE_FEATURES) ? s + extra : s);
    for ( const std::string& a : args )
        if ( !startsWith(a, DISABLE_FEATURES) )
            out.push_back(a);
    return out;
}

bool skipRelaunch(const std::vector<std::string>& args)
{
    // Options traitées sans démarrer le moteur ; une relance déjà faite ne se répète pas.
    for ( const std::string& a : args )
        if ( a == "--version" || a == "--help" || a == "--assoc" || startsWith(a, "--set-instapp-port") )
            return true;
    return std::getenv(RELAUNCH_MARK) != nullptr;
}

#ifdef _WIN32
std::string toUtf8(const wchar_t* text)
{
    const int size = WideCharToMultiByte(CP_UTF8, 0, text, -1, nullptr, 0, nullptr, nullptr);
    std::string out(size > 0 ? size - 1 : 0, '\0');
    if ( size > 1 )
        WideCharToMultiByte(CP_UTF8, 0, text, -1, &out[0], size, nullptr, nullptr);
    return out;
}

std::wstring toWide(const std::string& text)
{
    const int size = MultiByteToWideChar(CP_UTF8, 0, text.c_str(), -1, nullptr, 0);
    std::wstring out(size > 0 ? size - 1 : 0, L'\0');
    if ( size > 1 )
        MultiByteToWideChar(CP_UTF8, 0, text.c_str(), -1, &out[0], size);
    return out;
}

// Règles de découpage de CommandLineToArgvW (guillemets et barres obliques inverses).
void appendQuoted(std::wstring& cmd, const std::wstring& arg)
{
    if ( !cmd.empty() )
        cmd += L' ';
    if ( !arg.empty() && arg.find_first_of(L" \t\n\v\"") == std::wstring::npos ) {
        cmd += arg;
        return;
    }
    cmd += L'"';
    for ( auto it = arg.begin(); ; ++it ) {
        size_t backslashes = 0;
        while ( it != arg.end() && *it == L'\\' ) {
            ++it;
            ++backslashes;
        }
        if ( it == arg.end() ) {
            cmd.append(backslashes * 2, L'\\');
            break;
        }
        if ( *it == L'"' ) {
            cmd.append(backslashes * 2 + 1, L'\\');
            cmd += L'"';
        } else {
            cmd.append(backslashes, L'\\');
            cmd += *it;
        }
    }
    cmd += L'"';
}
#endif
}

bool relaunchWithEngineSwitches(int argc, char* argv[])
{
    std::vector<std::string> args;
#ifdef _WIN32
    (void)argc;
    (void)argv;
    int count = 0;
    wchar_t** wargs = CommandLineToArgvW(GetCommandLineW(), &count);
    if ( !wargs )
        return false;
    for ( int i = 1; i < count; ++i )
        args.push_back(toUtf8(wargs[i]));
    LocalFree(wargs);
#else
    for ( int i = 1; i < argc; ++i )
        args.push_back(argv[i]);
#endif
    if ( hasEngineSwitches(args) || skipRelaunch(args) )
        return false;

    const std::vector<std::string> full = withEngineSwitches(args);
#ifdef _WIN32
    wchar_t exe[MAX_PATH * 2];
    const DWORD len = GetModuleFileNameW(nullptr, exe, MAX_PATH * 2);
    if ( len == 0 || len >= MAX_PATH * 2 )
        return false;
    std::wstring cmd;
    appendQuoted(cmd, exe);
    for ( const std::string& a : full )
        appendQuoted(cmd, toWide(a));
    SetEnvironmentVariableA(RELAUNCH_MARK, "1");
    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    ZeroMemory(&pi, sizeof(pi));
    if ( !CreateProcessW(exe, &cmd[0], nullptr, nullptr, FALSE, 0, nullptr, nullptr, &si, &pi) ) {
        SetEnvironmentVariableA(RELAUNCH_MARK, nullptr);
        return false;
    }
    AllowSetForegroundWindow(pi.dwProcessId);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    return true;
#else
    std::vector<char*> nargv;
    nargv.push_back(argv[0]);
    for ( const std::string& a : full )
        nargv.push_back(const_cast<char*>(a.c_str()));
    nargv.push_back(nullptr);
    setenv(RELAUNCH_MARK, "1", 1);
    execv("/proc/self/exe", nargv.data());
    unsetenv(RELAUNCH_MARK);   // échec d'execv : on continue avec les réglages persistants
    return false;
#endif
}

std::wstring defaultUserName()
{
    return CLangater::getCurrentLangCode().startsWith(QStringLiteral("fr"))
            ? QString::fromUtf8(AUXI_DEFAULT_USER_NAME_FR).toStdWString()
            : QString::fromUtf8(AUXI_DEFAULT_USER_NAME_EN).toStdWString();
}

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
    // Sous Linux la configuration Qt suit déjà XDG : ~/.config/auxinux-office/
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
    // Copies de travail (documents décompressés) d'une session interrompue (plantage, arrêt
    // par SIGTERM) : le moteur ne les supprime qu'à la fermeture normale. Appelé seulement par
    // l'instance principale, avant que le moteur ne recrée le dossier.
    const QString cache = QString::fromStdWString(AscAppManager::getInstance().m_oSettings.cache_path);
    if ( !cache.isEmpty() )
        QDir(cache + QStringLiteral("/work_temp")).removeRecursively();
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
    // AuxiText dans un onglet d'AuxiNux Office ; sinon l'application AuxiText.
    if ( files.isEmpty() ) {
        if ( openTextTab(QString()) )
            return true;
    } else {
        QStringList rest;
        for ( const QString& f : files )
            if ( !openTextTab(f) )
                rest.append(f);
        if ( rest.isEmpty() )
            return true;
        return startTextEditor(rest);
    }
    return startTextEditor(files);
}

bool startTextEditor(const QStringList& files)
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

    return openIfTextFile(!opts.wurl.empty() ? QString::fromStdWString(opts.wurl) : opts.url);
}

bool openIfTextFile(QString path)
{
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
