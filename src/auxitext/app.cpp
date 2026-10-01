/*
 * AuxiText — éditeur de texte brut d'AuxiNux Office
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

#include "app.h"

#include <QApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QLocale>
#include <QPalette>
#include <QProcess>
#include <QStandardPaths>
#include <QStyle>
#include <QTranslator>
#include <cstdio>

#ifdef Q_OS_WIN
# include <windows.h>
#endif

#ifndef AUXI_VERSION
# define AUXI_VERSION "0.0.0"
#endif

namespace App {

QString version()
{
    return QStringLiteral(AUXI_VERSION);
}

QString versionLine()
{
    return QStringLiteral("AuxiText %1 (AuxiNux Office)").arg(version());
}

void printToConsole(const QString& text)
{
    const QByteArray line = text.toUtf8() + "\n";
#ifdef Q_OS_WIN
    HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
    bool attached = false;
    if (out == NULL || out == INVALID_HANDLE_VALUE || GetFileType(out) == FILE_TYPE_UNKNOWN) {
        if (AttachConsole(ATTACH_PARENT_PROCESS)) {
            attached = true;
            out = CreateFileW(L"CONOUT$", GENERIC_WRITE, FILE_SHARE_WRITE, NULL, OPEN_EXISTING, 0, NULL);
        }
    }
    if (out != NULL && out != INVALID_HANDLE_VALUE) {
        DWORD written = 0;
        WriteFile(out, line.constData(), DWORD(line.size()), &written, NULL);
    }
    if (attached)
        FreeConsole();
#else
    fwrite(line.constData(), 1, size_t(line.size()), stdout);
    fflush(stdout);
#endif
}

#ifdef Q_OS_WIN
static QString windowsConfigDir()
{
    QString roaming = QString::fromLocal8Bit(qgetenv("APPDATA"));
    if (roaming.isEmpty())
        roaming = QDir::homePath() + QStringLiteral("/AppData/Roaming");
    return QDir::fromNativeSeparators(roaming) + QStringLiteral("/AuxiNux/AuxiOffice");
}
#endif

QSettings& settings()
{
#ifdef Q_OS_WIN
    static QSettings s(windowsConfigDir() + QStringLiteral("/auxitext.ini"), QSettings::IniFormat);
#else
    // ~/.config/auxioffice/auxitext.conf (respecte XDG_CONFIG_HOME)
    static QSettings s(QSettings::IniFormat, QSettings::UserScope, QStringLiteral("auxioffice"),
                       QStringLiteral("auxitext"));
#endif
    return s;
}

static QString shellLocale()
{
#ifdef Q_OS_WIN
    QSettings shell(windowsConfigDir() + QStringLiteral("/settings.ini"), QSettings::IniFormat);
    const QString user = shell.value(QStringLiteral("locale")).toString();
    if (!user.isEmpty())
        return user;
    // Comme le shell : langue choisie à l'installation (HKLM\Software\AuxiNux\AuxiOffice).
    QSettings machine(QSettings::NativeFormat, QSettings::SystemScope, QStringLiteral("AuxiNux"),
                      QStringLiteral("AuxiOffice"));
    return machine.value(QStringLiteral("locale")).toString();
#else
    QSettings shell(QSettings::NativeFormat, QSettings::UserScope, QStringLiteral("auxioffice"),
                    QStringLiteral("AuxiOffice"));
    return shell.value(QStringLiteral("locale")).toString();
#endif
}

QString uiLanguagePreference()
{
    return settings().value(QStringLiteral("ui/language"), QStringLiteral("system")).toString();
}

void setUiLanguagePreference(const QString& pref)
{
    settings().setValue(QStringLiteral("ui/language"), pref);
}

static QString supported(const QString& code)
{
    const QString lang = code.left(2).toLower();
    if (lang == QLatin1String("fr") || lang == QLatin1String("en"))
        return lang;
    return QString();
}

QString resolvedUiLanguage()
{
    const QString env = QString::fromLocal8Bit(qgetenv("AUXITEXT_LANG"));
    if (!supported(env).isEmpty())
        return supported(env);
    const QString pref = uiLanguagePreference();
    if (!supported(pref).isEmpty())
        return supported(pref);
    const QString shell = supported(shellLocale());
    if (!shell.isEmpty())
        return shell;
    const QString system = supported(QLocale::system().name());
    return system.isEmpty() ? QStringLiteral("fr") : system;
}

void installTranslators(const QString& language)
{
    static QTranslator* app = nullptr;
    static QTranslator* qt = nullptr;
    for (QTranslator** t : {&app, &qt}) {
        if (*t) {
            qApp->removeTranslator(*t);
            delete *t;
            *t = nullptr;
        }
    }
    app = new QTranslator(qApp);
    if (app->load(QStringLiteral(":/i18n/auxitext_%1.qm").arg(language)))
        qApp->installTranslator(app);
    qt = new QTranslator(qApp);
    if (qt->load(QStringLiteral(":/i18n/qtbase_%1.qm").arg(language)))
        qApp->installTranslator(qt);
}

ThemeMode themeMode()
{
    const QString v = settings().value(QStringLiteral("ui/theme"), QStringLiteral("system")).toString();
    if (v == QLatin1String("light"))
        return ThemeMode::Light;
    if (v == QLatin1String("dark"))
        return ThemeMode::Dark;
    return ThemeMode::System;
}

void setThemeMode(ThemeMode mode)
{
    settings().setValue(QStringLiteral("ui/theme"),
                        mode == ThemeMode::Light ? QStringLiteral("light")
                        : mode == ThemeMode::Dark ? QStringLiteral("dark") : QStringLiteral("system"));
}

bool systemPrefersDark()
{
#ifdef Q_OS_WIN
    QSettings personalize(QStringLiteral("HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"),
                          QSettings::NativeFormat);
    return personalize.value(QStringLiteral("AppsUseLightTheme"), 1).toInt() == 0;
#else
    const QString gtkTheme = QString::fromLocal8Bit(qgetenv("GTK_THEME")).toLower();
    if (gtkTheme.contains(QLatin1String("dark")))
        return true;
    QProcess gsettings;
    gsettings.start(QStringLiteral("gsettings"),
                    {QStringLiteral("get"), QStringLiteral("org.gnome.desktop.interface"), QStringLiteral("color-scheme")});
    if (gsettings.waitForFinished(1500) && gsettings.exitStatus() == QProcess::NormalExit
        && gsettings.exitCode() == 0) {
        return QString::fromUtf8(gsettings.readAllStandardOutput()).contains(QLatin1String("dark"));
    }
    QFile gtk(QDir::homePath() + QStringLiteral("/.config/gtk-3.0/settings.ini"));
    if (gtk.open(QIODevice::ReadOnly)) {
        const QString ini = QString::fromUtf8(gtk.readAll()).toLower();
        return ini.contains(QLatin1String("gtk-application-prefer-dark-theme=1"))
               || ini.contains(QLatin1String("gtk-application-prefer-dark-theme=true"));
    }
    return false;
#endif
}

bool isDark()
{
    switch (themeMode()) {
    case ThemeMode::Light: return false;
    case ThemeMode::Dark:  return true;
    case ThemeMode::System: break;
    }
    return systemPrefersDark();
}

void applyPalette(bool dark)
{
    QPalette p = qApp->style()->standardPalette();
    if (dark) {
        const QColor window("#1E1F22"), base("#17181B"), text("#E6E6E3"), mid("#2B2D30"),
                     disabled("#6E7681"), accent("#F26F00");
        p.setColor(QPalette::Window, window);
        p.setColor(QPalette::WindowText, text);
        p.setColor(QPalette::Base, base);
        p.setColor(QPalette::AlternateBase, mid);
        p.setColor(QPalette::ToolTipBase, mid);
        p.setColor(QPalette::ToolTipText, text);
        p.setColor(QPalette::Text, text);
        p.setColor(QPalette::Button, mid);
        p.setColor(QPalette::ButtonText, text);
        p.setColor(QPalette::BrightText, QColor("#FF7B72"));
        p.setColor(QPalette::Link, QColor("#F2B713"));
        p.setColor(QPalette::Highlight, accent);
        p.setColor(QPalette::HighlightedText, QColor("#FFFFFF"));
#if QT_VERSION >= QT_VERSION_CHECK(5, 12, 0)
        p.setColor(QPalette::PlaceholderText, disabled);
#endif
        p.setColor(QPalette::Disabled, QPalette::Text, disabled);
        p.setColor(QPalette::Disabled, QPalette::ButtonText, disabled);
        p.setColor(QPalette::Disabled, QPalette::WindowText, disabled);
    } else {
        p.setColor(QPalette::Highlight, QColor("#F26F00"));
        p.setColor(QPalette::HighlightedText, QColor("#FFFFFF"));
        p.setColor(QPalette::Link, QColor("#C85A00"));
    }
    qApp->setPalette(p);
}

QString installDir()
{
    return QCoreApplication::applicationDirPath();
}

QString writerExecutable()
{
    // Le lanceur (et non le shell directement) : environnement du moteur et réglages de
    // confidentialité du moteur web ; à utiliser avec --writer.
#ifdef Q_OS_WIN
    return installDir() + QStringLiteral("/auxioffice.exe");
#else
    return installDir() + QStringLiteral("/auxioffice");
#endif
}

QString licensesIndex()
{
    return installDir() + QStringLiteral("/licenses/index.html");
}

}
