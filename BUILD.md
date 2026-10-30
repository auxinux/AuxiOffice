# Compiler, installer et tester AuxiOffice

## Installer

### AuxiNuxOS et Debian 13 (paquets)

Les paquets sont publiés dans le dépôt des applications d'AuxiNuxOS
(`deb https://dep.auxinux.ca/AUXINUXOS APPS main`) :

```sh
sudo auxi install --deb auxioffice   # la suite ; installe aussi AuxiText
sudo auxi install --deb auxitext     # AuxiText seul (sans LibreOffice ni la suite)
```

(`apt install` sur une Debian 13 qui a ce dépôt.) `auxinux-office`, l'ancien nom, est un paquet
de transition qui installe `auxioffice`.

Construire ces paquets : `scripts/build-deb.sh` (dans `target/deb/`), sur la machine de
l'architecture visée — **amd64** sur un PC x86_64, **arm64** sur une machine ARM64 (le moteur
LibreOffice ARM64 officiel est téléchargé par `scripts/fetch-engine.sh`).
`scripts/build-deb.sh --auxitext` ne construit qu'AuxiText (sans moteur). Sans machine ARM64 :
GitHub → Actions → « Paquets Debian » → Run workflow construit les paquets amd64 et arm64 dans
un conteneur Debian 13 et les joint au lancement (`.github/workflows/paquets-debian.yml`).

### Windows 11

> **En cours (bêta)** : l'installation et l'ouverture des documents fonctionnent ;
> l'enregistrement en place (Ctrl+S) ne répond pas encore sous Windows.

1. Installer [Git pour Windows](https://git-scm.com/download/win) (fournit Git Bash),
   [Rust](https://rustup.rs) (avec les outils de compilation C++ de Visual Studio que
   propose l'installateur) et [Node.js 22](https://nodejs.org) ou plus récent. WebView2 est
   déjà présent dans Windows 11.
2. Dans **Git Bash** :

   ```sh
   git clone https://github.com/auxinux/AuxiOffice.git
   cd AuxiOffice
   scripts/install-apps.sh
   ```

   Le script télécharge LibreOffice 26.8.1 (MSI officiel, vérifié par SHA-256, extrait sans
   l'installer dans Windows), compile, puis installe sans droits d'administrateur dans
   `%LOCALAPPDATA%\Programs\AuxiOffice` et `…\AuxiText` : menu Démarrer (dossier AuxiOffice,
   et AuxiText), « Ouvrir avec » pour les documents. Pour en faire l'application par défaut
   d'un type de fichier : clic droit → Ouvrir avec → Choisir une autre application.
3. Mettre à jour : `git pull` puis `scripts/install-apps.sh` ; retirer :
   `scripts/install-apps.sh --remove`.

### macOS (Apple Silicon)

1. Outils Apple : `xcode-select --install` ou, avec Xcode déjà installé ailleurs,
   `sudo xcode-select -s /chemin/vers/Xcode.app`.
2. Homebrew (https://brew.sh) ; le script installe lui-même autoconf, automake, libtool,
   pkgconf, GNU make, bison, flex, gperf, nasm, gettext, Python 3.13 et ninja.
3. Rust : `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`.
4. Node.js 22 ou plus récent (nodejs.org ou `brew install node`).
5. ```sh
   git clone https://github.com/auxinux/AuxiOffice.git
   cd AuxiOffice
   scripts/install-apps.sh
   ```

Les applications arrivent dans `~/Applications` (AuxiOffice, AuxiWriter, AuxiSheet,
AuxiPresent, AuxiDraw, AuxiPDF, AuxiText). Le LibreOffice officiel pour Mac ne peut pas servir de
moteur (il ne sait pas dessiner les pages pour un autre programme, voir ARCHITECTURE.md) : au
premier lancement, le script appelle `scripts/build-engine-macos.sh`, qui compile LibreOffice
26.8.1 depuis ses sources officielles avec `--enable-headless` : **1 à 3 heures et ~40 Go
d'espace disque, une seule fois** (une relance reprend la compilation).

### Linux (développement)

`scripts/install-apps.sh` ajoute les applications au menu (Bureautique, et AuxiText dans
Utilitaires) en utilisant la compilation du dépôt.

## Construire les applications et les installateurs

Un seul script, sur la machine du système visé : `scripts/build.sh` (Git Bash sous Windows,
Terminal sous macOS et Linux) ou `scripts/build.ps1` (PowerShell ; sous Windows il lance
`build.sh` dans le Bash de Git pour Windows). Aide : `-h`, `-help` ou `--help`.

| Git Bash / Terminal | PowerShell | Résultat |
|---|---|---|
| `scripts/build.sh` | `scripts\build.ps1` | les applications : la suite (avec son moteur) et AuxiText |
| `scripts/build.sh --auxitext` | `scripts\build.ps1 -AuxiText` | AuxiText seul (sans moteur, rapide) |
| `scripts/build.sh --installer` | `scripts\build.ps1 -Installer` | les applications et leurs installateurs |
| `scripts/build.sh --auxitext --installer` | `scripts\build.ps1 -AuxiText -Installer` | AuxiText et son installateur |

| Système | Applications | Installateurs (`--installer`) |
|---|---|---|
| Windows 11 x64 | `target\windows\AuxiOffice\` (AuxiOffice.exe, AuxiWriter.exe…, moteur dans `engine\`), `target\windows\AuxiText\` | `AuxiOffice-<version>-windows-x64-setup.exe` (la suite, et AuxiText : case cochée par défaut) et `AuxiText-<version>-windows-x64-setup.exe` |
| macOS Apple Silicon | `target/macos/AuxiOffice/` (AuxiOffice.app avec le moteur, AuxiWriter.app…, AuxiText.app), `target/macos/AuxiText/` | `AuxiOffice-<version>-macos-arm64.dmg` (la suite et AuxiText) et `AuxiText-<version>-macos-arm64.dmg` |
| Linux (Debian 13, AuxiNuxOS) | `target/release/auxioffice`, `auxitext` (moteur dans `.engine/`) | `target/deb/auxioffice_<version>_<arch>.deb` (dépend d'auxitext) et `auxitext_<version>_<arch>.deb` |

Les scripts propres à chaque système restent utilisables directement :
`scripts/build-win.sh` (et `scripts\build-win.ps1`), `scripts/build-mac.sh`, `scripts/build-deb.sh`.

**Windows.** Les installateurs (Inno Setup, `scripts/windows/*.iss`) installent pour
l'utilisateur courant, sans droits d'administrateur, au même endroit et avec les mêmes
raccourcis et entrées « Ouvrir avec » que `scripts/install-apps.sh` ; on les retire dans
Paramètres → Applications. Celui d'AuxiOffice embarque celui d'AuxiText et le lance :
AuxiText y apparaît comme une application à part (désinstallée séparément). `--installer`
demande Inno Setup 6 : `winget install JRSoftware.InnoSetup` (ou
`ISCC_EXE=<chemin de ISCC.exe>`). Si PowerShell refuse le script :
`powershell -ExecutionPolicy Bypass -File scripts\build.ps1 -Installer`.

**macOS.** Ouvrir le `.dmg` et glisser les applications dans Applications ; AuxiWriter.app,
AuxiSheet.app… utilisent le moteur d'AuxiOffice.app et doivent rester dans le même dossier.
Le moteur est compilé une fois s'il manque (`scripts/build-engine-macos.sh`, 1 à 3 h). Les
applications sont signées localement (« ad hoc ») : sur un autre Mac, macOS les bloque au
premier lancement (clic droit → Ouvrir, ou `xattr -dr com.apple.quarantine /Applications/Auxi*.app`) ;
une diffusion publique demande une signature Developer ID et une notarisation Apple.

**Linux.** `sudo apt install ./auxioffice_*.deb ./auxitext_*.deb` (ou
`sudo auxi install --deb` sous AuxiNuxOS) ; voir plus haut pour ARM64.

## Démarrage rapide (développement)

```sh
scripts/dev.sh                 # moteur + interface + compilation + lancement
scripts/dev.sh ~/Documents/rapport.docx
```

Au premier lancement, `scripts/dev.sh` prépare le moteur dans `.engine/` (téléchargé sous
Linux et Windows, compilé sous macOS), installe les dépendances npm et compile ; les
lancements suivants sont rapides. Sous Windows, lancer les scripts dans Git Bash.

## Prérequis

| Outil | Version | Rôle |
|---|---|---|
| Rust | 1.85 ou plus récent | coque, moteur |
| Node.js + npm | 22 ou plus récent | interface |
| Linux : WebKitGTK 4.1, GTK 3, libsoup 3 (paquets `-dev`) | | fenêtre Tauri |
| Python 3 + python-docx, openpyxl, python-pptx, Pillow | | documents de test, modèles |

Windows : WebView2 (fourni avec Windows 10/11). macOS : Xcode (outils en ligne de commande).

Les scripts de compilation (`build.sh`, `build.ps1`, `build-win.sh`, `build-mac.sh`,
`build-deb.sh`, `install-apps.sh`, `dev.sh`, `dev-text.sh`) vérifient ces prérequis
(`scripts/lib/prereqs.sh`) et proposent d'installer ce qui manque :

- Linux : `apt` (Debian, Ubuntu), `sudo auxi install --deb` (AuxiNuxOS), `dnf` ou `pacman`,
  puis Rust par rustup ;
- Windows : `winget` (Git, outils MSVC de Visual Studio, Node.js LTS, Python 3, Rust, et
  Inno Setup pour `--installer`) ;
- macOS : Homebrew (Node.js, Python), rustup ; les outils Xcode s'installent par
  `xcode-select --install`, puis on relance le script.

Windows 11 : le **contrôle intelligent des applications** (Smart App Control) bloque les
programmes non signés que Rust compile puis lance pendant la compilation (`could not execute
process … build-script-build`, « Une stratégie de contrôle d'application a bloqué ce fichier »,
`os error 4551`). Le script le détecte et demande de le désactiver : Sécurité Windows →
Contrôle des applications et du navigateur → Paramètres du contrôle intelligent des
applications → Désactivé. Sur un poste géré (stratégie WDAC de l'entreprise), il faut une
exception pour le dossier du dépôt.

`AUXI_INSTALL=oui` installe sans demander, `AUXI_INSTALL=non` s'arrête sans rien installer. Hors
d'un terminal (CI), les commandes à lancer sont affichées et le script s'arrête. Une version
trop ancienne de Node.js (moins de 20.19) ou de Rust (moins de 1.85) est signalée ; Rust est mis
à jour par rustup.

## Moteur LibreOffice

```sh
scripts/fetch-engine.sh      # Linux x86_64 ou ARM64 → .engine/linux-x86_64/ ou linux-aarch64/ ; Windows (Git Bash) → .engine/windows-x86_64/
scripts/build-engine-macos.sh  # Mac Apple Silicon → .engine/macos-aarch64/ (compilation)
```

Le script télécharge les fichiers listés dans `engine/libreoffice.lock.json`, vérifie leur
SHA-256 et extrait les paquets sans droits administrateur. Il affiche le dossier `program/` à
utiliser comme `AUXI_LO_PROGRAM`.

Windows : le MSI officiel est extrait par une installation administrative (`msiexec /a`),
sans rien inscrire dans le système. Le moteur y fait tourner la boucle de messages Win32 sur le
fil qui a initialisé LibreOffice (voir ARCHITECTURE.md).

## Compiler

```sh
cd app && npm install && npm run build && cd ..
cargo build -p auxi-engine
cargo build -p auxioffice --features custom-protocol   # interface intégrée
```

Sans `custom-protocol`, la coque charge l'interface depuis le serveur Vite
(`cd app && npm run dev`, port 5174), avec rechargement à chaud.

## Lancer en développement

```sh
target/release/auxioffice [--app office|writer|sheet|present|draw|pdf] [--new] [document…]
```

Lancé depuis `target/<profil>/`, l'exécutable trouve seul `auxi-engine`, le LibreOffice de
`.engine/` et les modèles du dépôt. Les variables ci-dessous remplacent ces emplacements.

L'application est choisie par `--app`, par la variable `AUXI_APP`, ou par le nom de
l'exécutable (`auxiwriter`, `AuxiSheet.app`…). `--new` ouvre un document vierge. Chaque
application n'a qu'une instance : la relancer transmet ses fichiers à la fenêtre ouverte.

## Installer les applications (développement)

```sh
scripts/install-apps.sh            # compile puis installe la suite et AuxiText
scripts/install-apps.sh --remove
```

- macOS : `~/Applications/Auxi*.app` (Finder, Launchpad, Dock, « Ouvrir avec »). Chaque paquet
  contient une copie de l'exécutable et le fichier `Resources/dev-root` qui désigne le dépôt
  (moteur et LibreOffice) : relancer le script après une recompilation.
- Linux : entrées `ca.auxinux.*.desktop` du menu des applications (Bureautique), icônes, et
  liens `target/release/auxiwriter`… vers `auxioffice` (classe de fenêtre propre à chaque
  application pour la barre des tâches).
- Windows : `%LOCALAPPDATA%\Programs\AuxiOffice` contient une copie de l'exécutable par
  application (`AuxiWriter.exe`… : le nom choisit l'application et Windows groupe ses fenêtres
  à part), `auxi-engine.exe`, le moteur (`engine\program`) et les modèles ; raccourcis du menu
  Démarrer et entrées « Ouvrir avec » (registre de l'utilisateur).

Dans un paquet, `AuxiOffice.app` (ou le dossier d'installation) contient le moteur ; sous macOS,
`AuxiWriter.app`, `AuxiSheet.app` et `AuxiPresent.app` le cherchent dans `AuxiOffice.app` voisin.

| Variable | Rôle | Par défaut (paquets) |
|---|---|---|
| `AUXI_APP` | application : `office`, `writer`, `sheet`, `present`, `draw`, `pdf` | d'après `--app` ou le nom de l'exécutable |
| `AUXI_ENGINE_EXE` | exécutable `auxi-engine` | à côté de `auxioffice` |
| `AUXI_LO_PROGRAM` | dossier `program/` de LibreOffice | `engine/program/` à côté de `auxioffice` (macOS : `Resources/engine/*.app`) |
| `AUXI_TEMPLATES` | modèles vierges | ressources de l'application (`templates/`) |
| `AUXI_LANG` | langue du moteur | `fr-FR` |
| `AUXI_AUTHOR` | auteur des modifications et commentaires | nom de session |

## AuxiText (éditeur de texte)

AuxiText n'a besoin ni du moteur ni de LibreOffice : Rust, Node.js et WebKitGTK suffisent.

```sh
scripts/dev-text.sh [fichier…]          # npm install + build + cargo build --release + lancement
AUXI_DEBUG=1 scripts/dev-text.sh        # compilation de débogage

# à la main
cd text && npm install && npm run build && cd ..
cargo build --release -p auxitext --features custom-protocol
target/release/auxitext [--new-window] [fichier…]
```

Sans `custom-protocol`, la coque charge l'interface depuis le serveur Vite
(`cd text && npm run dev`, port **5175**). Un second lancement transmet ses fichiers à la
fenêtre active (sans fichier ou avec `--new-window` : nouvelle fenêtre) ; un fichier absent
est créé à l'enregistrement.

Paquet Debian (construit par l'utilisateur sur sa machine) : `cd text && npx tauri build`
produit `target/release/bundle/deb/auxitext_<version>_amd64.deb`. Il ne dépend que de
WebKitGTK 4.1 et GTK 3, installe `ca.auxinux.AuxiText.desktop` (types MIME texte, `%F`), les
icônes et la fiche AppStream ; l'entrée `auxitext.desktop` générée par Tauri est masquée
(`NoDisplay`).

Fichiers de l'utilisateur : préférences dans `~/.config/ca.auxinux.text/preferences.json`,
fichiers récents et adresse de l'instance (`instance.json`, 0600) dans
`~/.local/share/ca.auxinux.text/`.

## Tester

```sh
scripts/test.sh
```

- interfaces : vérification TypeScript et tests `vitest` (`app/ui/src/*.test.ts`,
  `text/ui/src/*.test.ts` : langages, préférences, indentation, menus) ;
- Rust : tests unitaires (protocole, conversion des pixels ; AuxiText : encodages, BOM, fins
  de ligne, enregistrement atomique et droits, fichiers binaires, instance unique) ;
- intégration (`crates/auxi-engine/tests/engine.rs`), avec un vrai LibreOffice : édition et
  enregistrement Writer, formules Calc, diapositives Impress, verrous, requêtes invalides.
  Les documents sont générés par `tests/fixtures/generate.py`.

Les modèles vierges (`app/src-tauri/templates`) se régénèrent avec
`tests/fixtures/make_templates.py`.

## Intégration continue (GitHub Actions)

`.github/workflows/ci.yml` tourne à chaque envoi sur GitHub :

- **Linux x86_64**, **Linux ARM64** et **Windows x86_64** : moteur LibreOffice épinglé
  (`scripts/fetch-engine.sh`, mis en cache), `scripts/test.sh` complet (interfaces, coque,
  moteur avec de vrais documents), Clippy, compilation de production ; sous Windows, en plus,
  `scripts/install-apps.sh` et lancement d'AuxiWriter installé avec un document ;
- **macOS Apple Silicon** : compilation, tests sans moteur, Clippy, compilation de production
  (le moteur macOS se compile en 1 à 3 h).

`scripts/ci-npm.sh` installe et compile les deux interfaces (`app/`, `text/`). Aucun paquet
n'est construit par l'intégration continue.
