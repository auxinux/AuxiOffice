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
- **AuxiText depuis AuxiNux Office** : un fichier texte ouvert depuis AuxiNux Office (Ouvrir un
  fichier, documents récents, glisser-déposer, fichier transmis à l'instance ouverte) ou créé par
  la tuile « Nouveau fichier texte » s'ouvre dans l'application AuxiText, jamais dans AuxiWriter
  (sauf « Ouvrir dans AuxiWriter »). L'intégration aux onglets a été essayée puis désactivée :
  l'éditeur ne s'affichait pas sous Wayland (`apps.text.integrated_tabs`).
- Linux : une seule entrée de menu déclare la classe de fenêtre du shell (sous Wayland, la
  fenêtre d'AuxiNux Office s'affichait sous le nom « AuxiPresent »).
- **Lanceur `auxioffice`** : point d'entrée unique, détection du type de fichier, options
  `--new-*`, `--writer`, `--app=`, `--version`.
- **Écran d'accueil** : Nouveau document, Nouvelle feuille de calcul, Nouvelle présentation,
  Ouvrir PDF, Nouveau fichier texte, Ouvrir un fichier ; documents récents ; À propos avec la
  section « Logiciels libres et licences ».

### Identité et licences

- Nom du produit : toujours « AuxiNux Office ». Site dédié : <https://office.auxinux.ca>
  (accueil, À propos, aide, AuxiText, métadonnées des paquets). Identifiants techniques
  alignés sur le nom : `AuxiNuxOffice` (dossiers de réglages et de données Windows, registre,
  ProgID, AppUserModelID), `ca.auxinux.AuxiNuxOffice` (fichiers .desktop, AppStream, macOS),
  `auxinux-office` (dossiers XDG, `/usr/lib/auxinux-office`, protocole) ; la commande reste
  `auxioffice`.

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
- Retirés : modules DeepL, LanguageTool, Zotero, Thésaurus, OCR.
- IA et cloud au choix de l'utilisateur : panneau « Agent IA » de l'accueil affiché seulement
  si l'IA est activée dans les paramètres ; fournisseurs d'IA locaux (Ollama, LM Studio,
  GPT4All) en tête de liste, avec un avertissement à l'activation ; panneau « Clouds » limité
  aux services auto-hébergeables (Nextcloud, ownCloud, Seafile). Assistant IA désactivé par
  défaut. Détails : [PRIVACY.md](PRIVACY.md).
- Audit de confidentialité du 2026-10-02 (analyse du code livré et test avec des documents
  piégés), infractions corrigées :
  - ouvrir un DOCX, ODT, PPTX ou une page HTML téléchargeait ses images et feuilles de style
    distantes (pixel espion) : le convertisseur x2t passe par une garde AuxiNux qui lui
    interdit tout téléchargement ; pages de l'accueil, des éditeurs et des modules limitées
    aux ressources locales (`Content-Security-Policy`), préchargement DNS désactivé ;
  - le module Éditeur photo envoyait des statistiques à Google Analytics : désactivées ;
  - macOS : options réseau du moteur web non appliquées (sondes DNS sur HTTPS) : lanceur
    AuxiNux dans l'application ; adresse Google Analytics retirée du shell ; exception HTTP
    non chiffré retirée ;
  - auteur des documents rempli avec le nom réel du compte : nom neutre par défaut ;
  - un vidage mémoire de la machine de build se trouvait dans les installateurs Windows :
    retiré, le build refuse désormais d'emballer un vidage mémoire ou une adresse de traçage.
- Renforcements : le shell s'impose les options réseau du moteur s'il est démarré sans le
  lanceur ; correcteur orthographique de Chromium désactivé ; fournisseur d'IA relayé par un
  serveur d'ONLYOFFICE retiré ; copies de travail d'une session interrompue supprimées au
  démarrage ; réglages d'AuxiText lisibles par l'utilisateur seul.

### Linux

- Paquet `auxinux-office_0.1.0_amd64.deb` (dépendances calculées) et
  `AuxiNuxOffice-0.1.0-x86_64.AppImage` ; six entrées de menu, types MIME, AppStream ;
  répertoires XDG `~/.config/auxinux-office`, `~/.local/share/auxinux-office`, `~/.cache/auxinux-office`.

### Windows

- Installateur `AuxiNuxOffice-0.1.0-x64.exe` (installation et désinstallation, menu Démarrer,
  raccourci Bureau facultatif, Applications installées, App Paths, redistribuable Visual C++,
  installation silencieuse et options) et paquet `AuxiNuxOffice-0.1.0-x64.msi`.
- Types de fichiers déclarés (« Ouvrir avec », Applications par défaut) **sans jamais imposer**
  AuxiNux Office comme application par défaut.
- Réglages dans `%APPDATA%\AuxiNux\AuxiNuxOffice`, données et cache dans
  `%LOCALAPPDATA%\AuxiNux\AuxiNuxOffice`.

### macOS (préliminaire)

- Fichiers texte (TXT, MD, JSON…) ouverts depuis AuxiNux Office : renvoyés à AuxiText au lieu
  de rester dans AuxiWriter (le shell d'upstream les y envoie) ; « Ouvrir dans AuxiWriter »
  d'AuxiText garde le fichier dans AuxiWriter.
- Shell macOS compilé dans Xcode quand le build se fait sur un Mac (patch desktop-apps 0013) :
  Aide > Remerciements et Aide > Accord de licence fonctionnent (défaut d'upstream : ONLYOFFICE
  a le même) ; un fichier texte ouvert depuis l'application va directement dans AuxiText.

- `AuxiNuxOffice-0.1.0-arm64.zip` : application macOS Apple Silicon d'upstream réempaquetée
  depuis Linux (accueil et éditeurs AuxiNux, identité, textes et menus, icônes, mentions
  légales, mises à jour Sparkle désactivées, signature ad hoc). Sans AuxiText ; shell
  d'upstream non modifié. Non testée sur un Mac à ce jour ([docs/MACOS.md](docs/MACOS.md)).

### Mentions d'ONLYOFFICE

- Seules restent les mentions exigées par la licence d'origine : section « Logiciels libres et
  licences », fichiers LICENSE/NOTICE/licences, page « Accord de licence » (macOS), fichier
  `copyright` du paquet Debian. Retirées : copyright des exécutables et de l'application macOS,
  descriptions des paquets, page d'accueil de l'installateur, adresses d'aide du shell macOS.
- Panneau « Clouds » de l'accueil masqué (offres cloud d'ONLYOFFICE).

### Copyright

- Les composants contenant le code d'origine (application, shell, application macOS,
  installateurs) affichent les deux titulaires : « © 2026 Projet AuxiNux — © 2009-2026 Ascensio
  System SIA ». AuxiText et le lanceur, écrits entièrement par AuxiNux : « © 2026 Projet AuxiNux ».

### Corrections par rapport à ONLYOFFICE 9.4.0

- Linux : la fermeture de session (SIGTERM) provoquait une erreur de segmentation et un core
  dump (gestionnaire de signal du moteur) — patch desktop-apps 0010.
- Windows : « définir comme application par défaut » écrivait directement les choix de
  l'utilisateur (`UserChoice`) ; ouvre désormais les Paramètres Windows — patch 0008.
- Windows : ressource de version du shell aux couleurs d'AuxiNux — patch 0007.

### Build, tests, documentation

- Orchestrateur `scripts/auxibuild` (Python) ; versions upstream, binaires et outils épinglés
  et vérifiés (`upstream/upstream.lock.json`) ; file de 13 patches courts et outil de gestion
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

Builds complets du 2026-10-03 sur Debian 13 x86_64 (Linux ; Windows par compilation croisée ;
macOS réempaqueté depuis Linux), après l'audit de confidentialité et l'intégration d'AuxiText.

- **Linux : 50 tests automatiques sur 50 réussis** (dernier build : 48/50, les deux échecs —
  saisie clavier simulée perdue — réussissent rejoués seuls) — contrôles statiques (dont confidentialité :
  aucun traqueur ni vidage mémoire, CSP, garde du convertisseur, commutateurs du moteur),
  versions, 19 tests unitaires d'AuxiText, tests graphiques sans réseau (accueil, DOCX, XLSX,
  PPTX, PDF, AuxiText, fichiers texte confiés à AuxiText, arrêt par SIGTERM), audit réseau avec
  4 documents piégés (0 connexion, 0 lancement de curl/wget), conversions x2t.
- **Windows : 27 tests automatiques sur 27 réussis** (contrôles statiques et de
  confidentialité, versions et démarrage du shell sous Wine 10). Les essais d'installation sous
  Wine du 2026-10-02 n'ont pas été refaits avec ces installateurs.
- **macOS : 29 contrôles statiques sur 29 réussis** (lanceur, garde x2t, adresse Google
  Analytics retirée, signature) ; rien n'a été exécuté sur un Mac.
- Défauts trouvés et corrigés pendant la validation : lanceur Windows sans `converter\` dans le
  `PATH` du shell (le shell n'aurait pas démarré) ; logo ONLYOFFICE encore présent dans la
  fenêtre À propos et l'en-tête des éditeurs ; plantage du shell à la fermeture de session
  (SIGTERM) ; AuxiText ouvrant le shell sans passer par le lanceur ; infractions de
  confidentialité de l'audit (voir « Confidentialité »).

Empreintes SHA-256 des artefacts de ce build :

```text
0066f69ef09288d3d40c79949b9ef7da90316d176cadc8010ced53830f20e089  auxinux-office_0.1.0_amd64.deb
54b85a6d15d417a47b97bca3b032ff93104cd364ae4583e81674aeeed7dfa5fc  AuxiNuxOffice-0.1.0-x86_64.AppImage
1cd73a3a2aaada54da1a56fa97f9bdb6e5b0d6f0a61752f7bf8214af6b7defeb  AuxiNuxOffice-0.1.0-x64.exe
4cb954b10eb1136cbefa414d62d7dae3b03acbf93a4a0606dba29b6ddd867d5b  AuxiNuxOffice-0.1.0-x64.msi
6a0753ea222b6b0bf717a7bd1e69bd67157b0a05c1482fd7477500128e8276f4  AuxiNuxOffice-0.1.0-arm64.zip
```

### Limites connues

- **Pas encore validé sur un vrai Windows 10/11** : la version 0.1.0 n'est pas terminée tant
  que les scénarios obligatoires de [docs/TESTING-WINDOWS.md](docs/TESTING-WINDOWS.md) n'ont pas
  été passés.
- Paquets Linux pas encore testés dans une vraie session de bureau (Debian 13, Ubuntu 24.04,
  AuxiNux OS ; X11/Wayland ; impression réelle).
- Installateurs Windows non signés (avertissement SmartScreen) ; raccourcis du MSI sans
  AppUserModelID (le shell s'impose quand même les options réseau du moteur) ; le MSI requiert le redistribuable Visual C++ déjà installé.
- Aide hors ligne non livrée (l'aide en ligne d'upstream est retirée).
- Moteur natif et sdkjs repris de la release upstream vérifiée (non recompilés).
- glibc 2.38 minimum (Debian 12 non pris en charge).
- Build Windows natif (Visual Studio) non pris en charge : WSL 2 ou hôte Linux.
- Documents contenant des ressources distantes : comportement du moteur à évaluer.
