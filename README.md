# AuxiNux Office

**AuxiNux Office** (AuxiOffice) est la suite bureautique libre de l'écosystème
[AuxiNux](https://auxinux.ca) : traitement de texte, tableur, présentations, lecteur PDF et
éditeur de texte brut, utilisables **hors ligne, sans compte, sans publicité et sans
télémétrie**, sous Linux et Windows.

Version : **0.1.0** (fichier [`VERSION`](VERSION), source unique de la version).

| Application | Rôle | Formats principaux |
|---|---|---|
| **AuxiWriter** | traitement de texte | DOCX (prioritaire), DOC, ODT, RTF, TXT, HTML ; export PDF |
| **AuxiSheet** | tableur | XLSX (prioritaire), XLS, ODS, CSV |
| **AuxiPresent** | présentations | PPTX, PPT, ODP ; export PDF |
| **AuxiPDF** | lecteur PDF | PDF (aussi DjVu, XPS) |
| **AuxiText** | éditeur de texte brut léger | TXT, LOG, MD, CSV, JSON, XML, YAML, INI, CONF, sans extension |
| AuxiMail | *étude technique* ([docs/AUXIMAIL.md](docs/AUXIMAIL.md)) | — |

AuxiNux Office est un **fork maintenable d'[ONLYOFFICE Desktop Editors](https://github.com/ONLYOFFICE/DesktopEditors)**
9.4.0 (Ascensio System SIA). Le moteur d'édition et de conversion d'upstream est réutilisé tel
quel ; AuxiNux y apporte une file de patches courte et documentée, son identité visuelle, un
écran d'accueil, des réglages respectueux de la vie privée, AuxiText, un lanceur commun et ses
propres paquets. Voir [ARCHITECTURE.md](ARCHITECTURE.md).

> AuxiNux Office est un projet indépendant. **Ce n'est pas un produit officiel d'ONLYOFFICE ni
> d'Ascensio System SIA.** ONLYOFFICE is a trademark of Ascensio System SIA.

## État de la version 0.1.0

Résumé honnête de ce qui a été vérifié (détails : [CHANGELOG.md](CHANGELOG.md),
[docs/TESTING-LINUX.md](docs/TESTING-LINUX.md), [docs/TESTING-WINDOWS.md](docs/TESTING-WINDOWS.md)) :

- **Linux x86_64** : compilé depuis zéro et testé automatiquement — **40 tests sur 40
  réussis** (versions, tests unitaires d'AuxiText, contrôles statiques, conversions du moteur,
  tests graphiques des cinq applications sous Xvfb sans réseau, audit réseau : 0 connexion).
  Paquets `.deb` (installation simulée par APT sur Debian 13) et AppImage produits ; pas encore
  essayés dans une vraie session de bureau.
- **Windows 10/11 x64** : compilé (compilation croisée), installateur `.exe` et paquet `.msi`
  produits ; contrôles statiques automatiques ; installation, désinstallation et ouverture de
  documents DOCX/XLSX/PPTX/PDF/TXT vérifiées **sous Wine** (indicatif). **Pas encore testé sur
  un vrai Windows 10/11** : conformément au cahier des charges, la version 0.1.0 ne sera
  déclarée terminée qu'après la validation de [docs/TESTING-WINDOWS.md](docs/TESTING-WINDOWS.md)
  sur Windows.
- **macOS Apple Silicon (préliminaire)** : application d'upstream réempaquetée depuis Linux
  (accueil, éditeurs, identité, mentions légales, Sparkle désactivé, signature ad hoc) ; pas
  d'AuxiText ; pas encore testée sur un Mac. Voir [docs/MACOS.md](docs/MACOS.md).

## Installation

### Linux (Debian 13, Ubuntu 24.04 ou plus récent, AuxiNux OS — x86_64)

```sh
sudo apt install ./auxinux-office_0.1.0_amd64.deb
```

ou, sans installation :

```sh
chmod +x AuxiNuxOffice-0.1.0-x86_64.AppImage
./AuxiNuxOffice-0.1.0-x86_64.AppImage
```

Fichiers : programme dans `/usr/lib/auxioffice/`, commandes `/usr/bin/auxioffice` et
`/usr/bin/auxitext`, réglages dans `~/.config/auxioffice/`, données dans
`~/.local/share/auxioffice/`, cache dans `~/.cache/auxioffice/`.

### Windows 10 22H2 / Windows 11 (x64)

Lancez `AuxiNuxOffice-0.1.0-x64.exe`. Installation silencieuse :

```bat
AuxiNuxOffice-0.1.0-x64.exe /S
msiexec /i AuxiNuxOffice-0.1.0-x64.msi /qn
```

Toutes les options (dossier, raccourci Bureau, types de fichiers, langue, redistribuable
Visual C++) sont décrites dans [BUILD.md](BUILD.md#53-installateurs-windows). L'installateur ne
définit **jamais** AuxiNux Office comme application par défaut : il le propose dans « Ouvrir
avec » et dans Paramètres > Applications > Applications par défaut, où vous choisissez.

Fichiers : `C:\Program Files\AuxiNux Office\`, réglages dans `%APPDATA%\AuxiNux\AuxiOffice\`,
données et cache dans `%LOCALAPPDATA%\AuxiNux\AuxiOffice\`.

### macOS 11+ (Apple Silicon) — préliminaire

Décompressez `AuxiNuxOffice-0.1.0-arm64.zip`, placez `AuxiNux Office.app` dans Applications,
puis autorisez-la (application non notarisée) :

```sh
xattr -dr com.apple.quarantine "/Applications/AuxiNux Office.app"
```

Détails et limites : [docs/MACOS.md](docs/MACOS.md).

## Utilisation

```text
auxioffice                     écran d'accueil
auxioffice rapport.docx        ouvre le fichier dans l'application adaptée
auxioffice notes.txt           ouvre le fichier texte dans AuxiText
auxioffice --new-document      nouveau document (aussi --new-spreadsheet, --new-presentation, --new-text)
auxioffice --writer notes.txt  force l'ouverture dans AuxiWriter
auxioffice --app=pdf doc.pdf   application cible explicite (writer, sheet, present, pdf, text)
auxioffice --version           AuxiNux Office 0.1.0
```

Sous Windows, la commande est `auxioffice.exe` (enregistrée dans « App Paths » : `Win+R`,
`auxioffice`).

## Construire AuxiNux Office

Un `git clone` puis une seule commande, sur la machine cible :

```sh
git clone git@git.auxinux.ca:Auxinux/AuxiNux_Office.git
cd AuxiNux_Office
./build.sh              # Linux x86_64 : .deb + AppImage dans dist/linux/
./build.sh              # Mac Apple Silicon : AuxiNux Office.app (avec AuxiText) dans dist/macos/
```

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1     # Windows 11 : .exe + .msi dans dist\windows\ (via WSL 2)
```

Prérequis installés ou proposés automatiquement : sur Mac, les outils de ligne de commande
d'Apple et Homebrew (puis Qt 5 et Node.js) ; sous Windows, WSL 2 (Ubuntu 24.04). Pour les
options avancées (compilation croisée, composants, CI) : `scripts/build-linux.sh`,
`scripts/build-windows.ps1`, `python3 scripts/auxibuild --help`.

Les versions de toutes les sources, binaires et outils sont épinglées (commit git ou SHA-256)
dans [`upstream/upstream.lock.json`](upstream/upstream.lock.json). Procédure complète,
dépendances et options : [BUILD.md](BUILD.md).

## Organisation du dépôt

```text
VERSION, LICENSE, NOTICE, AUTHORS     version unique et mentions légales
branding/                             identité AuxiNux (product.json, logos, icônes, générateur)
docs/                                 upstream, AuxiMail, tests, mises à jour
packaging/{common,linux,windows}/     types de fichiers, installateurs NSIS et MSI
patches/<dépôt upstream>/             file de patches AuxiNux (git format-patch)
scripts/                              build-linux.sh, build-windows.ps1, package-*, auxibuild (orchestrateur)
src/                                  code AuxiNux : shell (module AuxiNux), page d'accueil, AuxiText, lanceur
tests/                                fixtures, tests unitaires d'AuxiText, tests graphiques
upstream/                             verrou des versions upstream (sources dans upstream/src/, ignoré par git)
dist/                                 paquets produits
```

## Documentation

| Document | Contenu |
|---|---|
| [BUILD.md](BUILD.md) | build reproductible Linux et Windows, dépendances, options |
| [ARCHITECTURE.md](ARCHITECTURE.md) | composants, fonctionnement, emplacements, choix techniques |
| [LICENSING.md](LICENSING.md) | licences, obligations et marques |
| [PRIVACY.md](PRIVACY.md) | confidentialité et audit réseau |
| [CONTRIBUTING.md](CONTRIBUTING.md) | contribuer, patches, conventions |
| [CHANGELOG.md](CHANGELOG.md) | historique des versions |
| [ROADMAP.md](ROADMAP.md) | feuille de route |
| [docs/UPSTREAM.md](docs/UPSTREAM.md) | suivi d'ONLYOFFICE, synchronisation, conflits |
| [docs/UPDATES.md](docs/UPDATES.md) | préparation du système de mises à jour |
| [docs/AUXIMAIL.md](docs/AUXIMAIL.md) | étude technique d'AuxiMail |
| [docs/TESTING-LINUX.md](docs/TESTING-LINUX.md) | scénarios de test Linux |
| [docs/TESTING-WINDOWS.md](docs/TESTING-WINDOWS.md) | scénarios de test Windows |
| [docs/MACOS.md](docs/MACOS.md) | version macOS préliminaire : installation, limites, tests |
| [branding/README.md](branding/README.md) | identité visuelle et génération des ressources |

## Licence

AuxiNux Office est distribué sous la **GNU Affero General Public License v3** avec les
conditions additionnelles d'upstream (voir [LICENSE](LICENSE), [NOTICE](NOTICE) et
[LICENSING.md](LICENSING.md)). Dans l'application : **À propos > Logiciels libres et licences**.

---

## English summary

AuxiNux Office is the free office suite of the AuxiNux project: AuxiWriter (documents),
AuxiSheet (spreadsheets), AuxiPresent (presentations), AuxiPDF (PDF reader) and AuxiText
(plain-text editor). It works offline, without an account, ads or telemetry, on Linux and
Windows. It is a maintainable fork of ONLYOFFICE Desktop Editors 9.4.0 and is **not** an
official product of ONLYOFFICE or Ascensio System SIA. The interface is available in French
(primary language) and English. See [BUILD.md](BUILD.md) to build it and
[LICENSING.md](LICENSING.md) for the license (AGPL v3 with upstream's additional terms).
