/*
 * AuxiText — éditeur de texte brut d'AuxiNux Office
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Services applicatifs : réglages, langue, thème, chemins d'installation.
 */

#ifndef AUXITEXT_APP_H
#define AUXITEXT_APP_H

#include <QSettings>
#include <QString>

namespace App {

enum class ThemeMode { System, Light, Dark };

QString version();
QString versionLine();          // "AuxiText 0.1.0 (AuxiNux Office)"
void printToConsole(const QString& text);

QSettings& settings();          // ~/.config/auxioffice/auxitext.conf | %APPDATA%\AuxiNux\AuxiOffice\auxitext.ini

// Langue de l'interface : réglage AuxiText, sinon langue d'AuxiNux Office,
// sinon langue du système ; français par défaut (langue principale du projet).
QString uiLanguagePreference(); // "system", "fr", "en"
void setUiLanguagePreference(const QString& pref);
QString resolvedUiLanguage();
void installTranslators(const QString& language);

ThemeMode themeMode();
void setThemeMode(ThemeMode mode);
bool systemPrefersDark();
bool isDark();
void applyPalette(bool dark);

QString installDir();
QString writerExecutable();     // lanceur AuxiNux Office (ouverture dans AuxiWriter avec --writer)
QString licensesIndex();        // page des licences livrée avec AuxiNux Office

}

#endif // AUXITEXT_APP_H
