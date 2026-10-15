# Compiler et tester AuxiOffice

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
```

Le script télécharge les fichiers listés dans `engine/libreoffice.lock.json`, vérifie leur
SHA-256 et extrait les paquets sans droits administrateur. Il affiche le dossier `program/` à
utiliser comme `AUXI_LO_PROGRAM`.

Windows et macOS : les fichiers (MSI, DMG) et leurs sommes sont déjà épinglés dans
`engine/libreoffice.lock.json` ; les scripts d'extraction restent à écrire.

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
export AUXI_ENGINE_EXE=$PWD/target/debug/auxi-engine
export AUXI_LO_PROGRAM=$(cat .engine/linux-x86_64/program-dir)
export AUXI_TEMPLATES=$PWD/app/src-tauri/templates
target/debug/auxioffice [document]
```

| Variable | Rôle | Par défaut (paquets) |
|---|---|---|
| `AUXI_ENGINE_EXE` | exécutable `auxi-engine` | à côté de `auxioffice` |
| `AUXI_LO_PROGRAM` | dossier `program/` de LibreOffice | `engine/program/` à côté de `auxioffice` |
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
