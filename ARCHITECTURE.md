# Architecture d'AuxiNux Office

## 1. Principes

AuxiNux Office est un **fork hybride** d'ONLYOFFICE Desktop Editors 9.4.0 :

- **réutiliser** le moteur d'upstream (édition, rendu, conversion, compatibilité Microsoft
  Office et OpenDocument) sans le réécrire ;
- **reconstruire depuis les sources** ce qu'AuxiNux modifie : le shell natif Qt, l'écran
  d'accueil et l'interface des éditeurs ;
- **ajouter** des composants AuxiNux autonomes quand c'est plus simple et plus sûr qu'un patch :
  AuxiText, le lanceur `auxioffice`, l'identité visuelle, les paquets ;
- garder les **patches courts, séparés et documentés** ([docs/UPSTREAM.md](docs/UPSTREAM.md)),
  et tout automatiser (`scripts/auxibuild`) avec un même code pour Linux et Windows.

Le moteur natif complet (x2t, bibliothèques core, ascdocumentscore/CEF, Chromium, V8) n'est
pas recompilé en 0.1.0 : son build upstream (build_tools) recompile Chromium et demande des
heures et des dizaines de gigaoctets, pour un résultat identique puisqu'AuxiNux ne le modifie
pas. La release upstream est donc épinglée par SHA-256 et ses sources correspondantes sont
référencées par commit exact (même tag v9.4.0.129). Le passage au moteur compilé depuis les
sources est inscrit à la [feuille de route](ROADMAP.md).

## 2. Composants

```text
                 auxioffice  (lanceur AuxiNux, C portable)
                 │  détecte le type de fichier, prépare l'environnement du moteur,
                 │  ajoute les réglages de confidentialité du moteur web
        ┌────────┴──────────────────────────────┐
        ▼                                       ▼
 auxioffice-editors (shell Qt)              auxitext (Qt, autonome)
 desktop-apps/win-linux + module AuxiNux    TXT, LOG, MD, CSV, JSON, XML, YAML, INI…
   ├─ écran d'accueil (common/loginpage + src/startpage/auxinux.js)
   ├─ éditeurs web-apps : AuxiWriter, AuxiSheet, AuxiPresent, AuxiPDF
   │    └─ sdkjs (moteur JavaScript des documents)
   ├─ ascdocumentscore + qtascdocumentscore (desktop-sdk, CEF/Chromium)
   └─ converter/x2t : garde réseau AuxiNux -> x2t-engine (conversions DOCX/XLSX/PPTX/ODF/PDF…),
      polices, dictionnaires
```

| Composant | Origine | Emplacement dans le dépôt |
|---|---|---|
| Lanceur `auxioffice` | AuxiNux | `src/launcher/auxioffice.c` (+ ressources Windows `auxioffice.rc.in`) ; macOS : `src/launcher/auxioffice_macos.c` |
| Garde réseau du convertisseur (`x2t`) | AuxiNux | `src/x2tguard/x2t_guard.c` |
| Durcissement des pages web livrées (CSP, modules) | AuxiNux | `scripts/auxibuild/privacy.py` |
| Shell `auxioffice-editors` | desktop-apps (compilé) + patches + module AuxiNux | `patches/desktop-apps/`, `src/shell/auxinux/` |
| Écran d'accueil | desktop-apps/common/loginpage (compilé) + patch + module AuxiNux | `patches/desktop-apps/0006…`, `src/startpage/auxinux.js` |
| Éditeurs (interface) | web-apps (compilé) + patch + textes AuxiNux | `patches/web-apps/`, `scripts/auxibuild/branding_editors.py` |
| sdkjs | release upstream (compilé par upstream) ; option source | `--sdkjs source` |
| Moteur natif, CEF, Qt, polices, dictionnaires | release upstream vérifiée | `upstream/upstream.lock.json` |
| AuxiText | AuxiNux | `src/auxitext/` |
| Identité visuelle | AuxiNux | `branding/` |
| Paquets | AuxiNux | `scripts/auxibuild/package_*.py`, `packaging/` |

### 2.1 Lanceur `auxioffice`

Point d'entrée unique (menus, associations de fichiers, ligne de commande ; AuxiText l'utilise
pour « Ouvrir dans AuxiWriter »). Il :

1. traite `--version` et `--help` sans démarrer le moteur ;
2. traduit les options AuxiNux (`--new-document`, `--new-spreadsheet`, `--new-presentation`,
   `--new-text`, `--writer`, `--app=writer|sheet|present|pdf|text`) ;
3. envoie les fichiers texte brut à AuxiText (liste d'extensions de `branding/product.json`,
   sauf CSV qui va à AuxiSheet ; les fichiers sans extension sont reconnus par leur contenu) et
   les autres au shell ;
4. prépare l'environnement du moteur : `LD_LIBRARY_PATH` sous Linux, `converter\` en tête du
   `PATH` sous Windows (les bibliothèques du moteur y sont, comme dans le lanceur upstream) ;
5. ajoute au shell les options du moteur web qui suppriment les communications automatiques
   (`privacy.engine_switches` de `branding/product.json` : `--disable-features=DnsOverHttps
   --disable-background-networking --disable-domain-reliability --no-pings
   --disable-spell-checking`, voir [PRIVACY.md](PRIVACY.md)) ; un `--disable-features` de
   l'appelant est fusionné avec celui d'AuxiNux (Chromium ne retient que la dernière
   occurrence). Le shell vérifie lui-même ces options au démarrage et se relance avec elles
   s'il a été démarré sans le lanceur.

Sous Linux, il remplace son image par celle du shell (`execv`) ; sous Windows, il crée le
processus (sous-système GUI ; `--version` écrit dans la console parente ou la sortie
redirigée).

### 2.1 bis Garde réseau du convertisseur

Le convertisseur d'upstream (`x2t`) télécharge de lui-même les ressources distantes d'un
document pendant sa conversion (image liée par URL, ressources d'une page HTML). L'assemblage
le renomme `x2t-engine` et installe à sa place la garde AuxiNux (`src/x2tguard/x2t_guard.c`,
même code sous Linux, Windows et macOS) : elle ajoute l'option
`<options><allowNetworkRequest>false</allowNetworkRequest></options>` au fichier de paramètres
reçu du moteur, puis exécute `x2t-engine` avec les mêmes arguments. Si l'option ne peut pas
être ajoutée, la conversion est refusée.

### 2.2 Shell `auxioffice-editors`

Shell Qt d'upstream (fenêtres, onglets, fichiers récents, impression, dialogues, intégration
au système) compilé depuis desktop-apps avec les en-têtes de marque blanche prévus par upstream
(`src/prop/defines_p.h`, `version_p.h`, générés depuis `branding/product.json`) et le
**module AuxiNux** (`src/shell/auxinux/`, copié dans `win-linux/src/auxinux` au moment du
build). Le module regroupe le code AuxiNux appelé par les patches :

- `--version`, emplacements de configuration et de cache, nom d'application écrit dans les
  documents (`AuxiNux Office`) ;
- réglages par défaut respectueux de la vie privée (assistant IA désactivé tant que
  l'utilisateur ne l'active pas, pas de galerie de modèles en ligne, nom d'auteur neutre,
  commutateurs du moteur imposés, copies de travail d'une session interrompue supprimées) ;
- routage des fichiers texte vers AuxiText, commande « Ouvrir PDF », nouveau fichier texte ;
- section « Logiciels libres et licences » de la fenêtre À propos ;
- traductions françaises des messages ajoutés par AuxiNux ;
- sous Linux, arrêt standard sur SIGTERM (le gestionnaire du moteur plantait).

Instance unique : un second lancement transmet ses fichiers à l'instance active (mutex
`AuxiNux.AuxiNuxOffice.Editors` sous Windows ; sous Linux, socket d'upstream limité à l'interface
locale 127.0.0.1, port 13012 par défaut).

### 2.3 Écran d'accueil et éditeurs

L'écran d'accueil est la page HTML/JS de desktop-apps (`common/loginpage`), compilée avec
`src/startpage/auxinux.js` et `auxinux_branding.js` (généré) : six actions (Nouveau document,
Nouvelle feuille de calcul, Nouvelle présentation, Ouvrir PDF, Nouveau fichier texte, Ouvrir
un fichier), documents récents, À propos, textes français/anglais. Les éditeurs sont les
applications web-apps (documenteditor, spreadsheeteditor, presentationeditor, pdfeditor)
compilées avec les variables de marque blanche de leur `Gruntfile` ; AuxiNux remplace le nom
des éditeurs et complète la fenêtre À propos (mentions « basé sur ONLYOFFICE » et « projet
indépendant »). L'aide en ligne d'upstream n'est pas livrée (`help: false`).

### 2.4 AuxiText

Éditeur de texte brut léger, **indépendant du moteur d'édition** (Qt Widgets seulement, sans
moteur web), même code sous Linux et Windows : nouveau/ouvrir/enregistrer/enregistrer
sous, rechercher/remplacer (expressions régulières), numéros de ligne, retour à la ligne,
thèmes clair/sombre, encodages (UTF-8 avec ou sans BOM, UTF-16, Latin-1, Windows-1252),
détection et conservation des fins de ligne CRLF/LF, coloration minimale (JSON, XML, YAML,
Markdown, INI), fichiers récents, impression, glisser-déposer, surveillance des modifications
externes, « Ouvrir dans AuxiWriter ». Il utilise les bibliothèques Qt livrées avec le moteur
(aucune dépendance supplémentaire).

AuxiText existe sous deux formes, avec le même code :

- **l'application AuxiText** (programme `auxitext`, entrée de menu, association des fichiers
  texte, `auxioffice notes.txt`) ;
- **appelé par AuxiNux Office** : un fichier texte ouvert depuis AuxiNux Office (« Ouvrir un
  fichier », documents récents, glisser-déposer, fichier transmis à l'instance ouverte) ou créé
  par la tuile « Nouveau fichier texte » est confié à l'application AuxiText (module AuxiNux du
  shell, patches desktop-apps 0003 et 0012 ; macOS : patch 0013 et `src/macos/auxinux-mac-text.js`).
  Une intégration aux onglets (`src/shell/auxinux/texttabs.cpp`, sources d'AuxiText compilées
  dans le shell) existe mais est désactivée (`apps.text.integrated_tabs` de product.json) :
  l'éditeur ne s'affichait pas sous Wayland.

## 3. Arborescences installées

### Linux

```text
/usr/bin/auxioffice -> ../lib/auxinux-office/auxioffice
/usr/bin/auxitext   -> ../lib/auxinux-office/auxitext
/usr/lib/auxinux-office/            auxioffice, auxioffice-editors, auxitext, bibliothèques du moteur,
                                converter/ (x2t), editors/ (web-apps, sdkjs), fonts/, dictionaries/,
                                LICENSE.txt, NOTICE.txt, licenses/
/usr/share/applications/ca.auxinux.AuxiNuxOffice{,.Writer,.Sheet,.Present,.PDF,.Text}.desktop
/usr/share/icons/hicolor/*/apps/ca.auxinux.AuxiNuxOffice*.png|svg
/usr/share/metainfo/ca.auxinux.AuxiNuxOffice.metainfo.xml
```

Données de l'utilisateur (XDG) :

```text
~/.config/auxinux-office/AuxiNuxOffice.conf      réglages du shell (langue, fenêtres…)
~/.config/auxinux-office/auxitext.ini         réglages d'AuxiText
~/.local/share/auxinux-office/                données du moteur : data/settings.xml, polices
                                          analysées, fichiers récents, récupération, modules
~/.cache/auxinux-office/cef                   cache du moteur web
```

### Windows

```text
C:\Program Files\AuxiNux Office\           auxioffice.exe, auxioffice-editors.exe, auxitext.exe,
                                           DLL du moteur, converter\, editors\, …, uninstall.exe
%APPDATA%\AuxiNux\AuxiNuxOffice\settings.ini  réglages du shell (fichier INI au lieu du registre)
%APPDATA%\AuxiNux\AuxiNuxOffice\auxitext.ini  réglages d'AuxiText
%LOCALAPPDATA%\AuxiNux\AuxiNuxOffice\data\    données du moteur (settings.xml, polices, récents…)
%LOCALAPPDATA%\AuxiNux\AuxiNuxOffice\cache\   cache du moteur web
HKLM\Software\AuxiNux\AuxiNuxOffice           emplacement, version, langue choisie à l'installation,
                                           Capabilities (types de fichiers proposés)
```

## 4. Identité et version

- `VERSION` est la **source unique** de la version (0.1.0) : orchestrateur, en-têtes du shell,
  AuxiText (`$$cat(../../VERSION)`), lanceur, ressources Windows, paquets.
- `branding/product.json` décrit le produit (noms, éditeur, URL, couleurs, applications et
  leurs types de fichiers, identifiants Linux/Windows, options de confidentialité et de mises
  à jour). `branding/tools/generate_assets.py` en dérive logos, icônes, images de
  l'installateur ; l'étape `prepare` applique l'identité aux sources upstream (en-têtes de
  marque blanche, ressources du shell, page d'accueil, textes des éditeurs). Voir
  [branding/README.md](branding/README.md).

Icônes des fichiers : sous Windows, les types de fichiers déclarés utilisent les icônes
AuxiNux (ressources de `auxioffice.exe`). Sous Linux, les icônes des types standard (DOCX,
XLSX, PDF…) relèvent du thème d'icônes de l'utilisateur : AuxiNux Office n'installe pas
d'icônes qui remplaceraient celles du système pour tous les logiciels (même logique que pour
les applications par défaut) ; les icônes générées (`branding/generated/svg/mime-*.svg` et `png/<taille>/mime-*.png`) sont
disponibles pour un thème d'icônes AuxiNux OS.

## 5. Langues

Français (langue principale) et anglais. Shell : traductions d'upstream + traducteur AuxiNux
pour ses messages ; écran d'accueil : surcharges françaises/anglaises de `auxinux.js` ;
éditeurs : fichiers de langue d'upstream (noms et À propos complétés par AuxiNux) ; AuxiText :
fichiers Qt `.ts` (français/anglais) + traductions françaises de Qt. Langue par défaut :
français ; sous Windows, langue choisie à l'installation. Aucune traduction en ligne. Ajouter
une langue : fichiers `.ts` d'AuxiText, textes de `auxinux.js` et de `branding_editors.py`
(les autres textes viennent d'upstream, qui gère plus de 40 langues).

## 6. Confidentialité

Voir [PRIVACY.md](PRIVACY.md) : aucune télémétrie AuxiNux, communications automatiques
d'upstream désactivées (galerie de modèles, sondes DNS du moteur web, aide en ligne, modules
réseau, service de mise à jour), assistant IA désactivé par défaut, tests automatiques sans
réseau avec audit des connexions.

## 7. Build et paquets

`scripts/auxibuild` (Python) : `common` (chemins, téléchargements vérifiés), `fetch`
(sources et moteur), `patching` et `devpatches` (files de patches), `branding*` (identité),
`build_js` (npm/grunt), `build_native` et `build_auxitext` (C/C++, Linux et compilation
croisée Windows via `wincross`), `assemble`, `legal` (mentions légales), `testing`,
`package_linux` (.deb, AppImage), `package_windows` (NSIS, MSI), `update_info`. Voir
[BUILD.md](BUILD.md).

## 8. Mises à jour

Abstraction préparée, sans service en 0.1.0 : métadonnées `update-info.json` produites avec
chaque paquet, canal stable/bêta, aucune URL codée en dur. Voir [docs/UPDATES.md](docs/UPDATES.md).

## 9. Évolutions prévues dans l'architecture

- **AuxiPDF** : l'éditeur PDF d'upstream (pdfeditor) propose déjà commentaires, annotations
  et remplissage de formulaires ; AuxiNux les exposera et les testera progressivement (0.2.x)
  sans changer l'architecture ; signatures à étudier. Les opérations sur les pages (fusion, découpage) passeront par x2t/PdfFile.
- **Applications futures** (AuxiCalendar, AuxiContacts, AuxiNotes, AuxiMail) : le modèle est
  celui d'AuxiText — exécutable séparé, entrée dans `branding/product.json` (`apps`), types
  de fichiers dans `packaging/common/filetypes.json`, routage par le lanceur (`--app=`),
  fichiers `.desktop` et raccourcis générés. Rien n'est ajouté à 0.1.0. AuxiMail fait l'objet
  d'une étude ([docs/AUXIMAIL.md](docs/AUXIMAIL.md)).
- **Plateformes** : ARM64, Flatpak et RPM (0.3.x), macOS Apple Silicon (0.4.x) ; le découpage
  lanceur/shell/moteur et la marque blanche d'upstream sont prévus pour ces cibles.
