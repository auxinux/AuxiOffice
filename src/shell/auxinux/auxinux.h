/*
 * AuxiNux Office — extensions du shell natif (desktop-apps/win-linux).
 *
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Ce module est copié dans desktop-apps/win-linux/src/auxinux/ pendant l'étape
 * « prepare » du build. Les fichiers upstream n'appellent que de petits points
 * d'ancrage (patches/desktop-apps/*), toute la logique AuxiNux vit ici.
 */

#ifndef AUXINUX_SHELL_H
#define AUXINUX_SHELL_H

#include <QString>
#include <QStringList>
#include <QJsonObject>
#include <string>

class CAscApplicationSettings;
struct COpenOptions;

namespace AuxiNux {

// "AuxiNux Office 0.1.0" (format de --version, identique au lanceur auxioffice)
QString versionLine();

// Écrit versionLine() sur la sortie standard (console parente sous Windows).
void printVersion();

// Répertoires XDG / Windows propres à AuxiNux Office.
QString cacheDir();     // ~/.cache/auxioffice  |  %LOCALAPPDATA%\AuxiNux\AuxiOffice\cache
QString configFile();   // fichier INI (Windows uniquement) : %APPDATA%\AuxiNux\AuxiOffice\settings.ini

// Ajuste les réglages du moteur après setup_paths() : cache CEF dans le cache XDG,
// nom d'application écrit dans les métadonnées des documents produits.
void adjustSettings(CAscApplicationSettings& settings);

// Fichiers texte brut gérés par AuxiText (extensions de branding/product.json, sauf CSV).
bool isTextDocument(const QString& path);

// Lance AuxiText (processus séparé, léger) avec les fichiers donnés.
bool launchTextEditor(const QStringList& files);

// Si opts désigne un fichier local de texte brut, l'ouvre dans AuxiText et renvoie true.
bool routeToTextEditor(const COpenOptions& opts);

// Boîte de dialogue « Ouvrir un PDF » (filtre PDF), chemin vide si annulé.
QString selectPdfFile(int parentViewId);

// Complète les informations envoyées à la page « À propos » (version AuxiNux,
// mentions légales requises par la licence upstream, liens vers les licences).
void extendAboutInfo(QJsonObject& about);

}

#endif // AUXINUX_SHELL_H
