# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ; versions selon le
[versionnage sémantique](https://semver.org/lang/fr/).

## [0.1.0] — en validation (non publiée)

Première version d'AuxiNux Office, basée sur **ONLYOFFICE Desktop Editors 9.4.0 (build 129)**.
Elle ne sera publiée qu'après validation sur un vrai Windows 10/11 (voir « Vérifications »).

### Applications

- **AuxiWriter**, **AuxiSheet**, **AuxiPresent**, **AuxiPDF** : éditeurs d'ONLYOFFICE 9.4.0
  (DOCX, DOC, ODT, RTF, TXT, HTML ; XLSX, XLS, ODS, CSV ; PPTX, PPT, ODP ; PDF), aux couleurs
  d'AuxiNux, en français et en anglais.
- **AuxiText** : nouvel éditeur de texte brut léger, indépendant du moteur d'édition (TXT, LOG,
  MD, CSV, JSON, XML, YAML, INI, CONF, sans extension ; fins de ligne CRLF/LF conservées ;
  encodages ; rechercher/remplacer ; numéros de ligne ; thèmes clair/sombre ; coloration
  minimale), même code sous Linux et Windows.
- **Lanceur `auxioffice`** : point d'entrée unique, détection du type de fichier, options
  `--new-*`, `--writer`, `--app=`, `--version`.
- **Écran d'accueil** : Nouveau document, Nouvelle feuille de calcul, Nouvelle présentation,
  Ouvrir PDF, Nouveau fichier texte, Ouvrir un fichier ; documents récents ; À propos avec la
  section « Logiciels libres et licences ».

### Identité et licences

- Identité AuxiNux centralisée (`branding/product.json`, ressources générées) appliquée
  automatiquement au build : shell, accueil, éditeurs, icônes, installateurs ; **aucun logo
  ONLYOFFICE** dans l'interface livrée (vérifié par un test).
- Mentions exigées par la licence d'upstream : NOTICE, LICENSE.txt, licences tierces,
  mention « Modified by Projet AuxiNux » dans chaque fichier upstream modifié, mentions dans
  l'interface (accueil et éditeurs).

### Confidentialité

- Aucune télémétrie, publicité ni compte ; fonctionnement hors ligne.
- Désactivés : galerie de modèles en ligne, sondes DNS sur HTTPS et réseau d'arrière-plan du
  moteur web, aide en ligne, page d'inscription, service de mise à jour d'upstream.
- Retirés : modules DeepL, LanguageTool, Zotero, Thésaurus, OCR. Assistant IA désactivé par
  défaut. Détails : [PRIVACY.md](PRIVACY.md).

### Linux

- Paquet `auxinux-office_0.1.0_amd64.deb` (dépendances calculées) et
  `AuxiNuxOffice-0.1.0-x86_64.AppImage` ; six entrées de menu, types MIME, AppStream ;
  répertoires XDG `~/.config/auxioffice`, `~/.local/share/auxioffice`, `~/.cache/auxioffice`.

### Windows

- Installateur `AuxiNuxOffice-0.1.0-x64.exe` (installation et désinstallation, menu Démarrer,
  raccourci Bureau facultatif, Applications installées, App Paths, redistribuable Visual C++,
  installation silencieuse et options) et paquet `AuxiNuxOffice-0.1.0-x64.msi`.
- Types de fichiers déclarés (« Ouvrir avec », Applications par défaut) **sans jamais imposer**
  AuxiNux Office comme application par défaut.
- Réglages dans `%APPDATA%\AuxiNux\AuxiOffice`, données et cache dans
  `%LOCALAPPDATA%\AuxiNux\AuxiOffice`.

### macOS (préliminaire)

- `AuxiNuxOffice-0.1.0-arm64.zip` : application macOS Apple Silicon d'upstream réempaquetée
  depuis Linux (accueil et éditeurs AuxiNux, identité, textes et menus, icônes, mentions
  légales, mises à jour Sparkle désactivées, signature ad hoc). Sans AuxiText ; shell
  d'upstream non modifié. Non testée sur un Mac à ce jour ([docs/MACOS.md](docs/MACOS.md)).

### Corrections par rapport à ONLYOFFICE 9.4.0

- Linux : la fermeture de session (SIGTERM) provoquait une erreur de segmentation et un core
  dump (gestionnaire de signal du moteur) — patch desktop-apps 0010.
- Windows : « définir comme application par défaut » écrivait directement les choix de
  l'utilisateur (`UserChoice`) ; ouvre désormais les Paramètres Windows — patch 0008.
- Windows : ressource de version du shell aux couleurs d'AuxiNux — patch 0007.

### Build, tests, documentation

- Orchestrateur `scripts/auxibuild` (Python) ; versions upstream, binaires et outils épinglés
  et vérifiés (`upstream/upstream.lock.json`) ; file de 11 patches courts et outil de gestion
  (`auxibuild patches`) ; compilation croisée Windows depuis Linux (clang-cl, xwin) ;
  `scripts/build-linux.sh`, `package-deb.sh`, `package-appimage.sh`, `build-windows.ps1`,
  `package-windows.ps1`.
- Tests automatiques (unitaires, statiques, conversions, graphiques sans réseau, audit réseau,
  test facultatif sous Wine) ; modèles d'intégration continue GitHub/Forgejo (non exécutés).
- Documentation : README, BUILD, ARCHITECTURE, LICENSING, PRIVACY, CONTRIBUTING, ROADMAP,
  docs/UPSTREAM, docs/UPDATES, docs/AUXIMAIL (étude), docs/TESTING-LINUX, docs/TESTING-WINDOWS.
- Mises à jour : aucune vérification automatique en 0.1.0 ; métadonnées `update-info.json`
  préparées pour un futur service, sans URL codée en dur.

### Vérifications

Builds complets du 2026-10-02 sur Debian 13 x86_64 (Linux depuis zéro ; Windows par
compilation croisée).

- **Linux : 40 tests automatiques sur 40 réussis** — contrôles statiques, versions, 19 tests
  unitaires d'AuxiText, tests graphiques sans réseau (accueil, DOCX, XLSX, PPTX, PDF, AuxiText,
  arrêt par SIGTERM), audit réseau (0 connexion), 10 conversions x2t. `.deb` : installation
  simulée par APT sur Debian 13, dépendances satisfaites ; AppImage : lancée sous Xvfb.
- **Windows : 21 tests automatiques réussis**, 1 ignoré (tests fonctionnels sur Windows) ;
  essais sous Wine 10 avec les installateurs finaux : installation et désinstallation
  silencieuses (`.exe` et `.msi`), registre, raccourcis, démarrage et ouverture de documents
  DOCX/XLSX/PPTX/PDF/TXT ([docs/TESTING-WINDOWS.md](docs/TESTING-WINDOWS.md)).
- Défauts trouvés et corrigés pendant la validation : lanceur Windows sans `converter\` dans le
  `PATH` du shell (le shell n'aurait pas démarré) ; logo ONLYOFFICE encore présent dans la
  fenêtre À propos et l'en-tête des éditeurs ; plantage du shell à la fermeture de session
  (SIGTERM) ; AuxiText ouvrant le shell sans passer par le lanceur.

Empreintes SHA-256 des artefacts de ce build :

```text
f09c316363dd7f3f9a7ea18d84d2e8c270be4e92aa33af80c8edf733efc89892  auxinux-office_0.1.0_amd64.deb
728c18091998df65d3e1a2194bbbc881c6859c64bfc8698f20f057e2e72638a4  AuxiNuxOffice-0.1.0-x86_64.AppImage
1331d792cb136f776f724272c8d0897e0e11a8b299f2b8f0c170ad6c7222c589  AuxiNuxOffice-0.1.0-x64.exe
afb3fcf6f0c723374a34dd2ebecc0d50d95d9b273c9e1a61613789a578276eea  AuxiNuxOffice-0.1.0-x64.msi
```

### Limites connues

- **Pas encore validé sur un vrai Windows 10/11** : la version 0.1.0 n'est pas terminée tant
  que les scénarios obligatoires de [docs/TESTING-WINDOWS.md](docs/TESTING-WINDOWS.md) n'ont pas
  été passés.
- Paquets Linux pas encore testés dans une vraie session de bureau (Debian 13, Ubuntu 24.04,
  AuxiNux OS ; X11/Wayland ; impression réelle).
- Installateurs Windows non signés (avertissement SmartScreen) ; raccourcis du MSI sans
  AppUserModelID ; le MSI requiert le redistribuable Visual C++ déjà installé.
- Aide hors ligne non livrée (l'aide en ligne d'upstream est retirée).
- Moteur natif et sdkjs repris de la release upstream vérifiée (non recompilés).
- glibc 2.38 minimum (Debian 12 non pris en charge).
- Build Windows natif (Visual Studio) non pris en charge : WSL 2 ou hôte Linux.
- Documents contenant des ressources distantes : comportement du moteur à évaluer.
