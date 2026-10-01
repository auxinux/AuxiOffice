# Feuille de route

Les versions suivent le [versionnage sémantique](https://semver.org/lang/fr/). Les dates ne
sont pas fixées : une version sort quand ses critères sont remplis sous Linux **et** Windows.

## 0.1.x — finaliser et stabiliser la première version

- **Validation sur un vrai Windows 10 22H2 et Windows 11** ([docs/TESTING-WINDOWS.md](docs/TESTING-WINDOWS.md)) :
  condition de clôture de la 0.1.0.
- Tests d'installation du `.deb` et de l'AppImage sur Debian 13, Ubuntu 24.04 et AuxiNux OS
  avec un vrai bureau (GNOME, KDE ; X11 et Wayland), impression réelle, HiDPI.
- Publication conforme à l'AGPL : miroir durable des sources correspondantes (dépôt AuxiNux,
  sources upstream épinglées, Qt) à côté des paquets ([LICENSING.md](LICENSING.md)).
- Signature des installateurs Windows (Authenticode) et du dépôt APT.
- Aide hors ligne en français (remplace l'aide en ligne d'upstream, non livrée).
- Confidentialité : comportement des documents contenant des ressources distantes ;
  audit réseau automatisé sous Windows.
- « Envoyer par courriel » : détection du client de messagerie par défaut (Linux, Windows).
- Corrections de bogues remontés par les tests ; propositions des correctifs génériques à
  upstream ([docs/UPSTREAM.md](docs/UPSTREAM.md#candidats-à-proposer-à-upstream)).
- Suivi des versions correctives d'ONLYOFFICE 9.x.

## 0.2.x — AuxiPDF, AuxiText, performances

- **AuxiPDF** : annotations (surlignage, notes, dessin), commentaires, formulaires, puis
  opérations sur les pages (rotation enregistrée, réorganisation, suppression), fusion et
  découpage ; étude des signatures.
- **AuxiText** : onglets, rechercher dans plusieurs fichiers, plus de langages colorés,
  aperçu Markdown, réglages d'indentation, encodages supplémentaires.
- **Performances** : temps de démarrage, mémoire, ouverture des gros documents.
- Vérification des mises à jour sous Windows, avec accord de l'utilisateur
  ([docs/UPDATES.md](docs/UPDATES.md)) ; dépôt APT (dep.auxinux.ca, une fois défini).
- Build Windows natif (Visual Studio) en plus de la compilation croisée.

## 0.3.x — nouvelles plateformes Linux

- **ARM64** (aarch64) : moteur upstream ARM64, compilation du shell, d'AuxiText et du lanceur.
- **Flatpak** (Flathub ou dépôt AuxiNux) et **RPM** (Fedora, openSUSE).
- Moteur natif compilé depuis les sources (build_tools d'upstream), pour ne plus dépendre
  des binaires de la release.

## 0.4.x — macOS

- **macOS Apple Silicon** : shell macOS d'upstream (desktop-apps/macos), AuxiText (Qt),
  paquet `.dmg` signé et notarisé.

## Plus tard

- **AuxiMail** : messagerie selon les conclusions de [docs/AUXIMAIL.md](docs/AUXIMAIL.md)
  (intégration légère d'abord, puis Thunderbird configuré ou fork selon les moyens du projet).
- **AuxiCalendar**, **AuxiContacts** : calendrier et contacts (CalDAV, CardDAV), à articuler
  avec le choix fait pour AuxiMail.
- **AuxiNotes** : prise de notes locale (Markdown), proche d'AuxiText.
- Collaboration **facultative** (édition à plusieurs via un serveur choisi par l'utilisateur)
  et cloud **facultatif** ; synchronisation de réglages et de documents choisie par
  l'utilisateur.
- Intégration à **AuxiNux OS** (thème d'icônes et de types de fichiers, réglages par défaut,
  paquets du système).
- Modules (plugins) AuxiNux, vérifiés et respectueux de la vie privée.
