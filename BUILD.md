# Compiler et tester AuxiOffice

## Démarrage rapide (Linux ou Mac Apple Silicon)

```sh
git clone https://github.com/auxinux/AuxiOffice.git
cd AuxiOffice
scripts/dev.sh                 # moteur + interface + compilation + lancement
scripts/dev.sh ~/Documents/rapport.docx
```

Au premier lancement, `scripts/dev.sh` télécharge LibreOffice 26.8.1 (vérifié par SHA-256)
dans `.engine/`, installe les dépendances npm et compile ; les lancements suivants sont
rapides.

### Sur Mac

1. Outils Apple : `xcode-select --install` ou, avec Xcode déjà installé ailleurs,
   `sudo xcode-select -s /chemin/vers/Xcode.app`.
2. Homebrew (https://brew.sh) ; le script installe lui-même autoconf, automake, libtool,
   pkgconf, GNU make, bison, flex, gperf, nasm, gettext, Python 3.13 et ninja.
3. Rust : `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`.
4. Node.js 22 ou plus récent (nodejs.org ou `brew install node`).
5. `scripts/dev.sh`.

Le LibreOffice officiel pour Mac ne peut pas servir de moteur (il ne sait pas dessiner les
pages pour un autre programme, voir ARCHITECTURE.md). Au premier lancement, `dev.sh` appelle
donc `scripts/build-engine-macos.sh`, qui compile LibreOffice 26.8.1 depuis ses sources
officielles avec `--enable-headless` : **1 à 3 heures et ~40 Go d'espace disque, une seule
fois** (une relance reprend la compilation). Le résultat est dans `.engine/macos-aarch64/`.

## Prérequis

| Outil | Version | Rôle |
|---|---|---|
| Rust | 1.85 ou plus récent | coque, moteur |
| Node.js + npm | 22 ou plus récent | interface |
| Linux : WebKitGTK 4.1, GTK 3, libsoup 3 (paquets `-dev`) | | fenêtre Tauri |
| Python 3 + python-docx, openpyxl, python-pptx, Pillow | | documents de test, modèles |

Windows : WebView2 (fourni avec Windows 10/11). macOS : Xcode (outils en ligne de commande).

## Moteur LibreOffice

```sh
scripts/fetch-engine.sh      # Linux x86_64 → .engine/linux-x86_64/
scripts/build-engine-macos.sh  # Mac Apple Silicon → .engine/macos-aarch64/ (compilation)
```

Le script télécharge les fichiers listés dans `engine/libreoffice.lock.json`, vérifie leur
SHA-256 et extrait les paquets sans droits administrateur. Il affiche le dossier `program/` à
utiliser comme `AUXI_LO_PROGRAM`.

Windows : le MSI et sa somme sont épinglés dans `engine/libreoffice.lock.json` ; le script
d'extraction reste à écrire.

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
target/release/auxioffice [--app office|writer|sheet|present] [--new] [document…]
```

Lancé depuis `target/<profil>/`, l'exécutable trouve seul `auxi-engine`, le LibreOffice de
`.engine/` et les modèles du dépôt. Les variables ci-dessous remplacent ces emplacements.

L'application est choisie par `--app`, par la variable `AUXI_APP`, ou par le nom de
l'exécutable (`auxiwriter`, `AuxiSheet.app`…). `--new` ouvre un document vierge. Chaque
application n'a qu'une instance : la relancer transmet ses fichiers à la fenêtre ouverte.

## Installer les applications (développement)

```sh
scripts/install-apps.sh            # compile puis installe AuxiOffice, AuxiWriter, AuxiSheet, AuxiPresent
scripts/install-apps.sh --remove
```

- macOS : `~/Applications/Auxi*.app` (Finder, Launchpad, Dock, « Ouvrir avec »). Chaque paquet
  contient une copie de l'exécutable et le fichier `Resources/dev-root` qui désigne le dépôt
  (moteur et LibreOffice) : relancer le script après une recompilation.
- Linux : entrées `ca.auxinux.*.desktop` du menu des applications (Bureautique), icônes, et
  liens `target/release/auxiwriter`… vers `auxioffice` (classe de fenêtre propre à chaque
  application pour la barre des tâches).
- Windows (paquets à venir) : un raccourci par application, `AuxiOffice.exe --app writer`, ou une
  copie nommée `AuxiWriter.exe`.

Dans un paquet, `AuxiOffice.app` (ou le dossier d'installation) contient le moteur ; sous macOS,
`AuxiWriter.app`, `AuxiSheet.app` et `AuxiPresent.app` le cherchent dans `AuxiOffice.app` voisin.

| Variable | Rôle | Par défaut (paquets) |
|---|---|---|
| `AUXI_APP` | application : `office`, `writer`, `sheet`, `present` | d'après `--app` ou le nom de l'exécutable |
| `AUXI_ENGINE_EXE` | exécutable `auxi-engine` | à côté de `auxioffice` |
| `AUXI_LO_PROGRAM` | dossier `program/` de LibreOffice | `engine/program/` à côté de `auxioffice` (macOS : `Resources/engine/*.app`) |
| `AUXI_TEMPLATES` | modèles vierges | ressources de l'application (`templates/`) |
| `AUXI_LANG` | langue du moteur | `fr-FR` |
| `AUXI_AUTHOR` | auteur des modifications et commentaires | nom de session |

## Tester

```sh
scripts/test.sh
```

- interface : vérification TypeScript et tests `vitest` (`app/ui/src/*.test.ts`) ;
- Rust : tests unitaires (protocole, conversion des pixels) ;
- intégration (`crates/auxi-engine/tests/engine.rs`), avec un vrai LibreOffice : édition et
  enregistrement Writer, formules Calc, diapositives Impress, verrous, requêtes invalides.
  Les documents sont générés par `tests/fixtures/generate.py`.

Les modèles vierges (`app/src-tauri/templates`) se régénèrent avec
`tests/fixtures/make_templates.py`.
