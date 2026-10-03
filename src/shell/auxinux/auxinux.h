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
QString cacheDir();     // ~/.cache/auxinux-office  |  %LOCALAPPDATA%\AuxiNux\AuxiNuxOffice\cache
QString configFile();   // fichier INI (Windows uniquement) : %APPDATA%\AuxiNux\AuxiNuxOffice\settings.ini

// Tout début de main() : si le moteur web n'a pas reçu les commutateurs de confidentialité
// (binaire du shell lancé directement, raccourci épinglé à la barre des tâches, autre
// --disable-features), relance le shell avec ces commutateurs. Renvoie true si le processus
// courant doit se terminer (Windows : nouveau processus créé ; Linux : execv ne revient pas).
bool relaunchWithEngineSwitches(int argc, char* argv[]);

// Nom d'auteur par défaut des documents, commentaires et modifications suivies tant que
// l'utilisateur n'en a pas choisi un (au lieu du nom du compte du système).
std::wstring defaultUserName();

// Ajuste les réglages du moteur après setup_paths() : cache CEF dans le cache XDG,
// nom d'application écrit dans les métadonnées des documents produits.
void adjustSettings(CAscApplicationSettings& settings);

// Réglages par défaut respectueux de la vie privée, appliqués avant l'initialisation
// du moteur (assistants IA désactivés tant que l'utilisateur ne les active pas) ; supprime
// les copies de travail des documents laissées par une session interrompue.
void applyPrivacyDefaults();

// Traductions des messages propres à AuxiNux dans le shell (français, anglais), selon la
// langue de l'interface ; à appeler une fois l'application Qt créée.
void installTranslator();

#ifdef __linux
// À appeler avant la boucle d'événements : arrêt standard sur SIGTERM (le gestionnaire du
// moteur ferme l'application depuis le signal et se termine par une erreur de segmentation).
void restoreDefaultSignals();
#endif

// Fichiers texte brut gérés par AuxiText (extensions de branding/product.json, sauf CSV).
bool isTextDocument(const QString& path);

// Ouvre les fichiers texte (ou un nouveau fichier si la liste est vide) dans AuxiText, intégré
// dans un onglet d'AuxiNux Office (texttabs.h) ; à défaut, dans l'application AuxiText.
bool launchTextEditor(const QStringList& files);

// Lance l'application AuxiText (processus séparé) avec les fichiers donnés.
bool startTextEditor(const QStringList& files);

// Si opts désigne un fichier local de texte brut, l'ouvre dans AuxiText et renvoie true.
bool routeToTextEditor(const COpenOptions& opts);

// Même chose pour un chemin (ou une adresse file://) : ligne de commande, glisser-déposer.
bool openIfTextFile(QString path);

// Boîte de dialogue « Ouvrir un PDF » (filtre PDF), chemin vide si annulé.
QString selectPdfFile(int parentViewId);

// Complète les informations envoyées à la page « À propos » (version AuxiNux,
// mentions légales requises par la licence upstream, liens vers les licences).
void extendAboutInfo(QJsonObject& about);

}

#endif // AUXINUX_SHELL_H
