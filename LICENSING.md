# Licences d'AuxiNux Office

Ce document recense les licences des composants d'AuxiNux Office, les obligations qu'elles
imposent à la distribution et la manière dont AuxiNux les respecte. Il ne constitue pas un
avis juridique ; en cas de doute, le texte des licences fait foi.

## 1. En résumé

- AuxiNux Office est distribué sous la **GNU Affero General Public License version 3**
  (AGPL-3.0-only) avec les **conditions additionnelles** du programme d'origine (section 7 de
  l'AGPL), parce qu'il modifie et redistribue ONLYOFFICE Desktop Editors.
- Le code écrit par le projet AuxiNux (`src/`, `scripts/`, patches) est publié sous
  **AGPL-3.0-or-later**, compatible avec l'ensemble.
- **AuxiNux Office n'est pas un produit officiel d'ONLYOFFICE ni d'Ascensio System SIA.**
  ONLYOFFICE is a trademark of Ascensio System SIA ; aucune licence de marque n'est accordée ni
  revendiquée.
- Fichiers de référence : [`LICENSE`](LICENSE) (texte de l'AGPL v3), [`NOTICE`](NOTICE)
  (attribution et modifications), [`AUTHORS`](AUTHORS) ; dans l'application installée :
  `LICENSE.txt` (licence d'upstream avec ses conditions additionnelles), `NOTICE.txt`
  (modifications de la version, commits upstream utilisés), `licenses/` (licences et listes de
  composants tiers) et la section **À propos > Logiciels libres et licences**.

## 2. Composants et licences

| Composant | Titulaire | Licence | Dans AuxiNux Office |
|---|---|---|---|
| Code AuxiNux : AuxiText, lanceur, module du shell, page d'accueil, orchestrateur, patches | Projet AuxiNux | AGPL-3.0-or-later | `src/`, `scripts/`, `patches/` |
| ONLYOFFICE : core, desktop-sdk, desktop-apps, web-apps, sdkjs (sources et binaires) | Ascensio System SIA | AGPL-3.0-only + conditions additionnelles | shell et interface recompilés et modifiés ; moteur repris de la release 9.4.0 |
| Éléments non logiciels d'ONLYOFFICE (illustrations, jeux d'icônes, rédaction technique) | Ascensio System SIA | CC BY-SA 4.0 | icônes et images de l'interface des éditeurs |
| Identité visuelle AuxiNux (`branding/`) | Projet AuxiNux | CC BY-SA 4.0 (noms et logos : signes distinctifs, voir §5) | logos, icônes, images de l'installateur |
| Police Carlito (contours des lettres des logos) | Łukasz Dziedzic, Carlito Project Authors | SIL OFL 1.1 | `branding/fonts/`, `licenses/OFL-1.1-Carlito.txt` |
| Chromium Embedded Framework, Chromium, V8, ANGLE, SwiftShader… | Google, Marshall Greenblatt et autres | BSD et licences diverses | moteur web (`libcef`) |
| Qt 5 (5.9.9 Linux, 5.15.2 Windows) | The Qt Company et autres | LGPL-3.0 | bibliothèques partagées livrées par upstream |
| ICU 74 | Unicode, Inc. | Unicode License V3 | `licenses/ICU-LICENSE.txt` |
| Hunspell et dictionnaires, polices, bibliothèques C++ et JavaScript du moteur | divers | voir listes | `licenses/3DPARTY-*.md|txt` (listes d'upstream) |
| libvlc (Windows, lecture audio/vidéo) | VideoLAN et autres | LGPL-2.1+ | DLL livrées par upstream |
| Microsoft Visual C++ Redistributable 2015-2022 x64 (installateur .exe) | Microsoft | termes de licence Microsoft (redistribuable) | installé s'il est absent |
| Runtime AppImage (type 2) | AppImage project | MIT (inclut squashfuse, BSD-2 ; libfuse, LGPL-2.1) | en-tête de l'AppImage |
| Sparkle (application macOS, mises à jour désactivées) | Sparkle Project | MIT | `Sparkle.framework` livré par upstream |
| Stub de l'installateur NSIS | contributeurs NSIS | zlib/libpng (+ LZMA, domaine public/CPL) | `AuxiNuxOffice-<version>-x64.exe` |

Les listes détaillées des composants tiers d'upstream sont installées dans `licenses/`
(`3DPARTY-core.md`, `3DPARTY-desktop-sdk.md`, `3DPARTY-desktop.txt`, `3DPARTY-web-apps.md`,
`3DPARTY-sdkjs.md`) et consultables depuis `licenses/index.html`.

## 3. Conditions additionnelles d'ONLYOFFICE et leur application

La licence d'upstream (`LICENSE.txt` installé ; `upstream/src/desktop-apps/LICENSE`) ajoute
à l'AGPL v3 cinq conditions (section 7). AuxiNux les applique ainsi :

| Condition | Application dans AuxiNux Office |
|---|---|
| 1. Conserver les mentions de droit d'auteur, de licence, de garantie et d'origine | les en-têtes des fichiers upstream sont conservés ; licences et listes tierces installées ; `NOTICE` et `NOTICE.txt` |
| 2. Marquer les versions modifiées (avec dates) et indiquer qu'elles sont basées sur ONLYOFFICE d'Ascensio System SIA | chaque fichier upstream modifié porte « Modified by Projet AuxiNux on 2026-10-01 » ; `NOTICE.txt` liste les modifications de la version (sujets des patches) et les commits upstream ; date de début des modifications : 2026-10-01 |
| 3. Mentions légales dans l'interface : identifier ONLYOFFICE comme développeur d'origine, signaler la version modifiée, donner accès à la licence | écran d'accueil, **À propos > Logiciels libres et licences** ; fenêtre « À propos » de chaque éditeur ; liens vers `LICENSE.txt`, `NOTICE.txt`, `licenses/index.html` |
| 4. Aucune licence de marque (7 e) | logos, icônes et identité ONLYOFFICE remplacés par l'identité AuxiNux ; le nom ONLYOFFICE n'est utilisé que pour indiquer l'origine du code, avec la mention de marque |
| 5. Éléments non logiciels sous CC BY-SA 4.0 | attribution dans `NOTICE` ; les éléments modifiés ou ajoutés par AuxiNux sont publiés sous la même licence |

Texte affiché dans l'application (français ; anglais selon la langue de l'interface) :

> AuxiNux Office est un logiciel libre développé dans le cadre du projet AuxiNux. AuxiNux
> Office utilise et modifie des composants provenant de ONLYOFFICE Desktop Editors 9.4.0,
> développé à l'origine par Ascensio System SIA.
> AuxiNux Office est un projet indépendant et n'est pas un produit officiel de ONLYOFFICE ou
> d'Ascensio System SIA.
> Il s'agit d'une version modifiée : modifications apportées par le projet AuxiNux depuis le
> 2026-10-01.
> Licence : GNU Affero General Public License version 3, avec les conditions additionnelles du
> programme d'origine.
> ONLYOFFICE est une marque d'Ascensio System SIA. Aucun droit de marque n'est accordé.

## 4. Code source correspondant

L'AGPL (section 6) impose de fournir le **code source correspondant** avec chaque
distribution binaire (`.deb`, AppImage, `.exe`, `.msi`). Pour AuxiNux Office, il se compose :

1. du dépôt AuxiNux Office au commit de la version (code AuxiNux, patches, scripts de build,
   identité) ;
2. des sources upstream aux **commits exacts** de `upstream/upstream.lock.json`
   (desktop-apps, web-apps, sdkjs, desktop-sdk, core, build_tools, DesktopEditors ; tag
   v9.4.0.129), qui correspondent à la release dont le moteur est repris ;
3. des sources des bibliothèques sous LGPL livrées sous forme binaire (Qt 5.9.9 et 5.15.2,
   libvlc), et de la configuration de build d'upstream (dépôt build_tools au commit épinglé).

**Obligation de publication (à faire avant toute diffusion publique)** : héberger ces sources
de façon durable (par exemple des miroirs sur l'infrastructure AuxiNux) et indiquer leur
emplacement à côté des paquets. Pointer uniquement vers GitHub est admis par la section 6 d)
de l'AGPL, mais la responsabilité de leur disponibilité reste celle du distributeur. L'adresse
du dépôt source est inscrite dans `branding/product.json` (`source_url`) et affichée dans
l'application.

## 5. Marques

- **ONLYOFFICE** est une marque d'Ascensio System SIA. AuxiNux Office n'utilise ni son logo ni
  son identité visuelle ; le nom n'apparaît que pour indiquer l'origine du code et dans les
  mentions légales (politique de marque d'upstream : <https://www.onlyoffice.com/trademark-policy>).
- Les noms **AuxiNux**, AuxiNux Office, AuxiWriter, AuxiSheet, AuxiPresent, AuxiPDF, AuxiText et
  leurs logos sont des signes distinctifs du projet AuxiNux. La licence AGPL ne donne pas de
  droit sur ces marques (section 7 e) : une version dérivée distribuée par un tiers doit
  changer de nom et d'identité (`branding/product.json` et `branding/` le permettent sans
  toucher au code).

## 6. Composants Microsoft utilisés pour la cible Windows

- **Compilation** : le CRT MSVC et le SDK Windows sont téléchargés par xwin uniquement après
  acceptation explicite de leurs licences par la personne qui lance le build
  (`--accept-msvc-license`). Les exécutables AuxiNux sont liés dynamiquement au CRT (`/MD`) et
  ne contiennent que les petites parties statiques prévues pour la redistribution (code de
  démarrage). Les personnes qui publient les binaires doivent disposer des droits Microsoft
  correspondants (par exemple Visual Studio Community, autorisé pour le développement de
  logiciels libres).
- **Redistribution** : l'installateur `.exe` contient `vc_redist.x64.exe` (version et SHA-256
  épinglés), redistribuable selon les termes de licence de Microsoft ; il n'est installé que
  s'il manque, et peut être omis (`/NOVCREDIST`).

## 7. Contributions

Toute contribution est publiée sous AGPL-3.0-or-later (code) ou CC BY-SA 4.0 (ressources non
logicielles), sauf mention contraire acceptée explicitement. Les nouveaux fichiers portent un
en-tête `SPDX-License-Identifier`. Voir [CONTRIBUTING.md](CONTRIBUTING.md).
