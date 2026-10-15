# Compiler et tester AuxiOffice

## Démarrage rapide (Linux ou Mac Apple Silicon)

```sh
git clone https://git.auxinux.ca/Auxinux/AuxiOffice.git
cd AuxiOffice
scripts/dev.sh                 # moteur + interface + compilation + lancement
scripts/dev.sh ~/Documents/rapport.docx
```

Au premier lancement, `scripts/dev.sh` télécharge LibreOffice 26.2.6 (vérifié par SHA-256)
dans `.engine/`, installe les dépendances npm et compile ; les lancements suivants sont
rapides.

### Sur Mac

1. Outils Apple : `xcode-select --install` ou, avec Xcode déjà installé ailleurs,
   `sudo xcode-select -s /chemin/vers/Xcode.app`.
2. Rust : `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`.
3. Node.js 22 ou plus récent (nodejs.org ou `brew install node`).
4. `scripts/dev.sh`.

Le moteur est la `LibreOffice.app` officielle, copiée depuis son image disque dans
`.engine/macos-aarch64/` (aucune installation dans `/Applications`). La version Mac n'a pas
encore été essayée : si le moteur refuse de démarrer, le terminal affiche la cause.

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
scripts/fetch-engine.sh      # Linux x86_64 ou macOS arm64 → .engine/<plateforme>/
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
export AUXI_ENGINE_EXE=$PWD/target/debug/auxi-engine
export AUXI_LO_PROGRAM=$(cat .engine/*/program-dir)
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
