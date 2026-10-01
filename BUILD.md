# Construire AuxiNux Office

Ce document décrit le build **reproductible** d'AuxiNux Office pour Linux x86_64 et
Windows x64 : hôtes, dépendances, versions, outils, variables, étapes et artefacts.

Principe : un seul orchestrateur, `scripts/auxibuild` (Python 3, sans dépendance externe),
appelé par les scripts `scripts/build-linux.sh` et `scripts/build-windows.ps1`. Toutes les
entrées sont épinglées dans [`upstream/upstream.lock.json`](upstream/upstream.lock.json)
(commit git exact ou URL + taille + SHA-256) et vérifiées à chaque build. Une étape en échec
arrête le build avec un code de sortie non nul et le message
« ÉCHEC … Le build n'est PAS terminé » : aucun artefact n'est alors valide.

## 1. Vue d'ensemble

```text
doctor    vérifie l'hôte (outils, en-têtes de développement)
fetch     sources upstream aux commits épinglés (clones superficiels, partiels)
          + moteur upstream précompilé (vérifié par SHA-256) + en-têtes ICU
prepare   remet les sources upstream à l'état exact du commit, applique patches/ puis le branding
build     page d'accueil, interface des éditeurs (npm + grunt), shell Qt, AuxiText, lanceur
assemble  arbre d'installation : moteur upstream + composants AuxiNux + mentions légales
test      tests automatiques (rapport dans build/test-reports/<cible>/)
package   .deb + AppImage (Linux) ; installateur .exe + .msi (Windows)
```

`all` enchaîne toutes les étapes. Ce qui est **compilé depuis les sources** : le shell Qt
(desktop-apps/win-linux), la page d'accueil (desktop-apps/common/loginpage), l'interface des
éditeurs (web-apps), AuxiText et le lanceur ; sdkjs peut l'être (option `--sdkjs source`).
Ce qui est **repris de la release upstream vérifiée** : le moteur natif (x2t, bibliothèques
core, ascdocumentscore, CEF/Chromium, Qt, dictionnaires, polices, sdkjs compilé). Voir
[ARCHITECTURE.md](ARCHITECTURE.md) pour les raisons de ce découpage.

## 2. Hôtes de build

| Hôte | Cibles | État |
|---|---|---|
| **Debian 13 (trixie) x86_64** | Linux, Windows (compilation croisée) | **testé** (build, tests, paquets) |
| Ubuntu 24.04 LTS x86_64 | Linux, Windows | prévu (mêmes paquets ; non testé à ce jour) |
| Windows 10/11 + WSL 2 (Debian 13 ou Ubuntu 24.04) | Windows (`build-windows.ps1`) | script fourni ; non testé sur Windows à ce jour |
| Windows natif (Visual Studio/MSVC) | Windows | non pris en charge en 0.1.0 (voir §7.3) |

Espace disque : environ 20 Go (sources upstream 3 Go dont `node_modules`, archives du moteur
1 Go, outils 3,6 Go, arbres de build 9 Go). Mémoire : 8 Go conseillés. Réseau : nécessaire
pour `fetch` (GitHub, npm, Debian, Qt, Microsoft pour la cible Windows) ; ensuite, les caches
(`upstream/cache/`, `.toolchains/`, `node_modules`) permettent de reconstruire sans réseau,
sauf `npm ci` si le cache npm a été vidé.

## 3. Dépendances de l'hôte Linux

### 3.1 Paquets (Debian/Ubuntu)

```sh
sudo apt install build-essential pkg-config git curl python3 python3-venv nodejs npm \
    libgtk-3-dev libglib2.0-dev libnotify-dev libcups2-dev libcupsimage2-dev libx11-dev \
    libx11-xcb-dev libxcb1-dev libxext-dev libdbus-1-dev libpulse-dev libgl-dev libatk1.0-dev \
    dpkg-dev fakeroot file desktop-file-utils
# tests graphiques et audit réseau
sudo apt install xvfb xdotool strace
# cible Windows depuis Linux
sudo apt install clang-19 lld-19 llvm-19 nsis wixl
```

`./scripts/build-linux.sh --local-deps` (ou `--local-deps` pour `auxibuild`) permet de
construire **sans droits root** sur Debian/Ubuntu : les paquets `-dev`, LLVM 19, NSIS, wixl,
`file` et `desktop-file-utils` manquants sont téléchargés avec `apt-get download` et extraits
dans `.toolchains/` (aucun fichier système modifié). `doctor` indique ce qui manque.

### 3.2 Versions utilisées sur l'hôte de référence

| Outil | Version testée | Remarque |
|---|---|---|
| Debian | 13 (trixie), noyau 6.12 | |
| Python | 3.13.5 | 3.10 minimum |
| GCC / G++ | 14.2.0 | shell, AuxiText, lanceur Linux ; `-static-libstdc++` |
| GNU Make | 4.4.1 | |
| Node.js / npm | 22.23.2 / 10.9.8 | Node.js 18 minimum (vérifié par `doctor`) |
| git | 2.47.3 | clones superficiels et partiels |
| dpkg-deb / fakeroot | 1.22.22 / 1.37.1.1 | paquet .deb (`dpkg-shlibdeps` pour les dépendances) |
| LLVM (clang-cl, lld-link, llvm-rc, llvm-dlltool) | 19.1.7 (Debian) | cible Windows |
| NSIS (makensis) | 3.11 | installateur Windows |
| wixl (msitools) | 0.106 | MSI Windows |

### 3.3 Outils et composants téléchargés et épinglés par l'orchestrateur

| Composant | Version | Vérification | Usage |
|---|---|---|---|
| Moteur ONLYOFFICE Linux (`onlyoffice-desktopeditors_amd64.deb`) | 9.4.0 build 129 | SHA-256 + taille | moteur Linux |
| Moteur ONLYOFFICE Windows (`DesktopEditors_x64.zip`) | 9.4.0 build 129 | SHA-256 + taille | moteur Windows |
| Sources desktop-apps, web-apps, sdkjs, desktop-sdk, core, DesktopEditors | tag v9.4.0.129 | commit exact | voir [docs/UPSTREAM.md](docs/UPSTREAM.md) |
| ICU 4c (en-têtes) | 74.2 | SHA-256 | en-têtes requis par le shell |
| Qt (aqtinstall 3.3.0) | 5.9.9 gcc_64 (Linux), 5.15.2 msvc2019_64 + gcc_64 (Windows) | dépôt Qt officiel | mêmes versions de Qt que celles livrées par upstream |
| xwin | 0.10.0 | SHA-256 | CRT MSVC **14.44.17.14** et SDK Windows **10.0.26100** (épinglés) |
| Microsoft Visual C++ Redistributable x64 | 14.44.35211.0 | SHA-256 + taille | inclus dans l'installateur .exe |
| appimagetool / runtime AppImage type 2 | 1.9.1 / 20251108 | SHA-256 | AppImage |
| Paquets Python des outils | aqtinstall 3.3.0, pefile 2024.8.26 | versions exactes (pip) | venv privé `.toolchains/venv` |
| Paquets Python des tests | python-docx 1.2.0, openpyxl 3.1.5, python-pptx 1.0.2, pypdf 6.19.0, reportlab 5.0.1, python-xlib 0.33, pillow 12.3.0 | versions exactes | création et vérification de documents |
| Dépendances npm (web-apps, page d'accueil) | `package-lock.json` d'upstream | `npm ci` | |

Un téléchargement dont la taille ou le SHA-256 ne correspond pas est supprimé et le build
s'arrête.

## 4. Build Linux

```sh
./scripts/build-linux.sh --release            # build complet + tests + paquets
./scripts/build-linux.sh --clean --release    # depuis des arbres propres
./scripts/build-linux.sh --debug              # avec symboles de débogage
./scripts/build-linux.sh --local-deps -j 8    # sans root, 8 tâches
./scripts/package-deb.sh                      # réempaqueter le .deb seulement
./scripts/package-appimage.sh                 # réempaqueter l'AppImage seulement
```

Artefacts :

```text
dist/linux/auxinux-office_0.1.0_amd64.deb
dist/linux/AuxiNuxOffice-0.1.0-x86_64.AppImage
dist/linux/update-info.json        métadonnées pour un futur service de mises à jour
dist/linux/SHA256SUMS
```

Le paquet `.deb` installe l'application dans `/usr/lib/auxioffice/`, les commandes
`/usr/bin/auxioffice` et `/usr/bin/auxitext`, six fichiers `.desktop`
(`ca.auxinux.AuxiOffice*.desktop`), les icônes hicolor, les métadonnées AppStream et la
documentation (`/usr/share/doc/auxinux-office/`). Ses dépendances sont calculées par
`dpkg-shlibdeps` à partir des bibliothèques réellement utilisées (notamment
`libc6 (>= 2.38)` : Debian 13 et Ubuntu 24.04 conviennent, pas Debian 12). Pendant le build,
chaque symbole importé par les binaires AuxiNux est vérifié contre les bibliothèques livrées
(`scripts/tools/check_elf_imports.py`).

## 5. Build Windows

### 5.1 Depuis Linux (chaîne de référence)

```sh
python3 scripts/auxibuild all --target windows --accept-msvc-license [--local-deps] [--clean]
python3 scripts/auxibuild package --target windows --formats exe      # installateur seul
```

La compilation croisée utilise clang-cl/lld-link (LLVM 19), le CRT MSVC et le SDK Windows
téléchargés par **xwin** et Qt 5.15.2 msvc2019_64. Ces composants Microsoft sont soumis aux
licences de Microsoft : l'option `--accept-msvc-license` (ou `AUXI_ACCEPT_MSVC_LICENSE=1`)
est **obligatoire** et vaut acceptation de ces licences par la personne qui lance le build
(voir [LICENSING.md](LICENSING.md)). Sans elle, le build s'arrête avant tout téléchargement.

Particularités gérées automatiquement (`scripts/auxibuild/wincross.py`) : enveloppes
`cl`/`link`/`rc` pour qmake, bibliothèques d'import générées depuis les DLL du moteur
(pefile + llvm-dlltool), vue insensible à la casse des en-têtes du SDK, conversion des
Makefile NMake de qmake pour GNU make, vérification de tous les imports des `.exe` produits.

### 5.2 Depuis Windows (WSL 2)

```powershell
.\scripts\build-windows.ps1 -Release -AcceptMsvcLicense
.\scripts\build-windows.ps1 -Clean -Release -AcceptMsvcLicense -Formats exe
.\scripts\package-windows.ps1                 # réempaqueter un build existant
Get-Help .\scripts\build-windows.ps1 -Detailed
```

Prérequis : WSL 2 avec Debian 13 ou Ubuntu 24.04 (`wsl --install -d Ubuntu-24.04`) et, dans
cette distribution, `python3`, `git`, `make`, `nodejs`/`npm` (≥ 18) ; les autres outils sont
extraits automatiquement (`--local-deps`). Le script exécute la même chaîne que §5.1 dans
WSL ; les fichiers volumineux restent dans `~/.cache/auxinux-office/` côté WSL (accès disque
rapide) et les paquets sont écrits dans `dist\windows\` du dépôt. Les scripts PowerShell sont
compatibles Windows PowerShell 5.1 et PowerShell 7 (sous Linux, ils appellent directement
l'orchestrateur).

Artefacts :

```text
dist/windows/AuxiNuxOffice-0.1.0-x64.exe     installateur (NSIS, x64 natif)
dist/windows/AuxiNuxOffice-0.1.0-x64.msi     paquet MSI (wixl)
dist/windows/update-info.json
dist/windows/SHA256SUMS
```

### 5.3 Installateurs Windows

**Installateur `.exe`** (`packaging/windows/nsis/auxioffice.nsi`) :

| Paramètre | Effet |
|---|---|
| `/S` | installation silencieuse |
| `/D=C:\Chemin\AuxiNux Office` | dossier d'installation (toujours en dernier, sans guillemets) |
| `/NODESKTOP` | pas de raccourci sur le Bureau (créé par défaut) |
| `/NOASSOC` | ne pas proposer AuxiNux Office pour les types de fichiers |
| `/NOVCREDIST` | ne pas installer le redistribuable Visual C++ (déjà déployé) |
| `/LANG=fr` ou `/LANG=en` | langue par défaut de l'application (défaut : langue de l'installateur) |

Codes de sortie : `0` succès, `1` annulé, `2` erreur (dont échec du redistribuable Visual C++),
`3010` succès avec redémarrage requis. Désinstallation : `"C:\Program Files\AuxiNux Office\uninstall.exe" /S`
(les documents et réglages personnels sont conservés).

**Paquet `.msi`** (`packaging/windows/wix/auxioffice.wxs.in`) :

```bat
msiexec /i AuxiNuxOffice-0.1.0-x64.msi /qn
msiexec /i AuxiNuxOffice-0.1.0-x64.msi /qn NODESKTOP=1 NOASSOC=1 APPLOCALE=en-US INSTALLDIR="D:\Apps\AuxiNux Office"
msiexec /x AuxiNuxOffice-0.1.0-x64.msi /qn
```

Le MSI n'embarque pas le redistribuable Visual C++ : déployez-le avant
(`vc_redist.x64.exe /install /quiet /norestart`), sinon l'installation s'arrête avec un message
explicite (condition de lancement, code 1603). wixl ne gère pas les propriétés de raccourci :
les raccourcis du MSI n'ont pas l'AppUserModelID (notifications Windows remplacées par des
boîtes de dialogue) ; l'installateur `.exe` est recommandé pour les postes individuels.

Dans les deux cas, AuxiNux Office est **déclaré** pour ses types de fichiers (ProgID
`AuxiOffice.<ext>`, `OpenWithProgids`, `Capabilities`, `RegisteredApplications`) mais
**jamais imposé** : les applications par défaut existantes ne sont pas modifiées.

## 6. Référence de l'orchestrateur

```text
python3 scripts/auxibuild <commande> [options]
commandes : doctor fetch prepare build assemble test package all clean
            patches checkout|export|status <dépôt>   (voir docs/UPSTREAM.md)
```

| Option | Rôle |
|---|---|
| `--target linux\|windows` | cible (défaut `linux`) |
| `--mode release\|debug` | type de build (défaut `release`) |
| `--clean` | sources upstream remises à zéro (y compris fichiers ignorés) et arbres de build supprimés |
| `-j N` | tâches parallèles |
| `--local-deps` | extraire localement les paquets manquants (Debian/Ubuntu, sans root) |
| `--accept-msvc-license` | accepter les licences Microsoft du CRT MSVC/SDK (cible Windows) |
| `--components js,shell,auxitext,launcher` | composants à construire (`js` = startpage + webapps + sdkjs) |
| `--sdkjs upstream\|source` | sdkjs compilé par upstream (défaut) ou concaténé depuis les sources (expérimental) |
| `--formats deb,appimage` / `exe,msi` | paquets à produire |
| `--skip-tests` | ne pas exécuter les tests (les artefacts ne sont alors pas validés) |

| Variable d'environnement | Rôle |
|---|---|
| `AUXI_BUILD_DIR`, `AUXI_UPSTREAM_SRC`, `AUXI_CACHE_DIR`, `AUXI_TOOLCHAINS_DIR`, `AUXI_DIST_DIR` | emplacements (défaut : `build/`, `upstream/src/`, `upstream/cache/`, `.toolchains/`, `dist/`) |
| `AUXI_BUILD_NUMBER` | quatrième nombre des versions Windows (défaut 0 ; intégration continue) |
| `AUXI_ACCEPT_MSVC_LICENSE=1` | équivalent de `--accept-msvc-license` |
| `AUXI_SDKJS_MODE` | équivalent de `--sdkjs` |
| `AUXI_UPDATE_CHANNEL` | canal inscrit dans `update-info.json` (`stable` par défaut, ou `beta`) |
| `AUXI_LLVM_DIR` | LLVM 19 déjà installé ailleurs |
| `SOURCE_DATE_EPOCH` | date des archives (défaut : date du dernier commit) |
| `AUXI_XVFB`, `AUXI_XDOTOOL`, `AUXI_STRACE`, `AUXI_TEST_DISPLAY` | outils des tests graphiques (défaut : ceux du `PATH`, écran `:97`) |
| `AUXI_WINE`, `AUXI_WINESERVER` | test facultatif de la cible Windows sous Wine |

## 7. Tests, reproductibilité, limites

### 7.1 Tests

L'étape `test` est exécutée par `all`. Linux : versions (`--version`), 19 tests unitaires
d'AuxiText, contrôles statiques (identité, mentions légales, plugins réseau retirés, absence
du service de mise à jour d'upstream), conversions du moteur, tests graphiques sous Xvfb (accueil, DOCX, XLSX, PPTX, PDF,
AuxiText, arrêt par SIGTERM) dans un espace de noms réseau isolé, avec audit réseau
(`strace`). Windows : imports PE, sous-système et métadonnées des exécutables ; test
facultatif sous Wine (`AUXI_WINE`). Le rapport est écrit dans
`build/test-reports/<cible>/report.md` (+ `report.json`, captures d'écran). Les scénarios
manuels sont dans [docs/TESTING-LINUX.md](docs/TESTING-LINUX.md) et
[docs/TESTING-WINDOWS.md](docs/TESTING-WINDOWS.md).

### 7.2 Reproductibilité

- Entrées épinglées et vérifiées (commits, SHA-256, versions exactes des outils et des
  paquets Python/npm) ; sources upstream remises à l'état exact du commit avant chaque
  application des patches.
- Archives `.deb` : propriétaire root uniformisé, compression fixe, `SOURCE_DATE_EPOCH`.
- Non encore reproductibles bit à bit : horodatages PE des exécutables Windows, installateur
  NSIS, MSI (le `ProductCode` est régénéré à chaque build, ce qui est voulu pour les mises à
  niveau) et AppImage (squashfs). Les sommes SHA-256 de `dist/*/SHA256SUMS` identifient donc
  un build précis, pas une version.

### 7.3 Limites connues (0.1.0)

- Build Windows **natif** (Visual Studio) non pris en charge : utilisez WSL 2 ou un hôte Linux.
- Le moteur natif (x2t, CEF…) n'est pas recompilé (release upstream vérifiée) ; le mode
  « moteur depuis les sources » (build_tools d'upstream) est prévu à la feuille de route.
- La cible Windows n'a pas encore été validée sur un vrai Windows 10/11
  ([docs/TESTING-WINDOWS.md](docs/TESTING-WINDOWS.md)).

## 8. Dépannage

| Symptôme | Cause et solution |
|---|---|
| `modules pkg-config manquants` | installer les paquets du §3.1 ou ajouter `--local-deps` |
| `La compilation croisée Windows télécharge le CRT MSVC…` | ajouter `--accept-msvc-license` après lecture des licences |
| `le sysroot Windows ne contient pas le CRT MSVC 14.44.17.14` | supprimer `.toolchains/winsysroot` puis relancer |
| `le patch … ne s'applique pas` | sources upstream modifiées ou verrou changé : voir [docs/UPSTREAM.md](docs/UPSTREAM.md) (« Conflits ») |
| `somme SHA-256 invalide` | téléchargement corrompu ou modifié : le fichier est supprimé, relancer ; si l'erreur persiste, ne pas contourner (vérifier l'origine) |
| tests graphiques ignorés | installer `xvfb` et `xdotool` (ou définir `AUXI_XVFB`/`AUXI_XDOTOOL`) |
| `Node.js >= 18 requis` | installer une version récente de Node.js |

## 9. Intégration continue

Deux modèles équivalents sont fournis : [`.github/workflows/build.yml`](.github/workflows/build.yml)
(GitHub Actions, exécuteurs Ubuntu 24.04) et [`.forgejo/workflows/build.yml`](.forgejo/workflows/build.yml)
(Forgejo Actions, exécuteur Debian 13 non root). Chaque modèle comporte un job `linux`
(build complet, tests, `.deb` et AppImage) et un job `windows` (compilation croisée, tests
statiques, `.exe` et `.msi`), publie les paquets et les rapports de test, et utilise
`AUXI_BUILD_NUMBER` pour numéroter les builds. Le job `windows` exige la variable de dépôt
`AUXI_ACCEPT_MSVC_LICENSE=1`, qui matérialise l'acceptation des licences Microsoft par les
mainteneurs. Ces modèles n'ont pas encore été exécutés ; le build manuel décrit ci-dessus
n'en dépend pas.
