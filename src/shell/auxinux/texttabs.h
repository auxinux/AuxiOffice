/*
 * AuxiNux Office — fichiers texte brut dans les onglets du shell (AuxiText intégré).
 *
 * Copyright (C) 2026 Projet AuxiNux
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * AuxiText reste une application à part entière (programme auxitext). Quand un fichier texte est
 * ouvert ou créé depuis AuxiNux Office, le même éditeur (code de src/auxitext, compilé dans le
 * shell) s'affiche dans un onglet, comme un document. L'onglet garde un moteur web vide et caché
 * (identifiant de vue attendu par la gestion des onglets d'upstream) ; l'éditeur Qt le recouvre.
 */

#ifndef AUXINUX_TEXTTABS_H
#define AUXINUX_TEXTTABS_H

#include <QString>

class QWidget;

namespace AuxiNux {

// Ouvre le fichier texte (ou un nouveau fichier si path est vide) dans un onglet de la fenêtre
// principale ; s'il est déjà ouvert, active son onglet. Renvoie false si l'intégration est
// impossible (pas de fenêtre principale) : l'appelant lance alors l'application AuxiText.
bool openTextTab(const QString& path);

// Onglet contenant un fichier texte (panneau CTabPanel) ?
bool isTextTab(QWidget* panel);

// Enregistrement demandé par le shell à la fermeture de l'onglet (« Enregistrer » du message
// « Enregistrer les modifications ? ») : 0 si ce n'est pas un onglet texte, 1 si le fichier est
// enregistré, -1 si l'enregistrement a échoué ou a été annulé.
int saveTextTab(QWidget* panel);

// Traductions de l'éditeur intégré, selon la langue de l'interface.
void installTextTranslator();

}

#endif // AUXINUX_TEXTTABS_H
