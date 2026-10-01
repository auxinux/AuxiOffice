# Suivi d'upstream (ONLYOFFICE Desktop Editors)

AuxiNux Office suit ONLYOFFICE Desktop Editors avec un minimum de modifications profondes :
moteur repris tel quel, marque blanche par les mécanismes prévus par upstream, file de
patches courte, tout le reste dans du code AuxiNux séparé. Ce document décrit la version
suivie, les patches, et les procédures de synchronisation et de résolution des conflits.

## 1. Version suivie

| | |
|---|---|
| Produit | ONLYOFFICE Desktop Editors |
| Version | **9.4.0**, build **129** (tag des sources `v9.4.0.129`, release `v9.4.0`) |
| Release | <https://github.com/ONLYOFFICE/DesktopEditors/releases/tag/v9.4.0> |
| Verrouillé le | 2026-10-01 |
| Fichier de verrou | [`upstream/upstream.lock.json`](../upstream/upstream.lock.json) (source unique de vérité) |

### Dépôts sources

| Dépôt | Commit | Utilisation par AuxiNux |
|---|---|---|
| [DesktopEditors](https://github.com/ONLYOFFICE/DesktopEditors) | `7b9cd379f428ce23c7ef9c93cbb93f1e3c75f613` | licence, CHANGELOG (fichiers légaux) |
| [desktop-apps](https://github.com/ONLYOFFICE/desktop-apps) | `3ad4e294ae5e25902ccc56088a760ad21a9d123a` | shell Qt (`win-linux`) et écran d'accueil (`common/loginpage`) : **compilés et patchés** |
| [web-apps](https://github.com/ONLYOFFICE/web-apps) | `1993a6d89731af0fcb5129ebf0ee380076fea5a9` | interface des éditeurs : **compilée et patchée** |
| [sdkjs](https://github.com/ONLYOFFICE/sdkjs) | `75b53d504bfd81bfa35d59bb57dd9e56f7c9235d` | licences ; compilé seulement avec `--sdkjs source` |
| [desktop-sdk](https://github.com/ONLYOFFICE/desktop-sdk) | `8f6d24bfe9a5e7ea9405266d341ed4187cf5823e` | en-têtes de libascdocumentscore/qt_wrapper (sparse) |
| [core](https://github.com/ONLYOFFICE/core) | `a016fc2868b9f99f59dd30aa2088e68bbe5104af` | fichiers qmake communs et en-têtes du moteur (sparse) |
| [build_tools](https://github.com/ONLYOFFICE/build_tools) | `cf4cac0846d03e2e00a6fec5d1ecd4e9463086d5` | référence du build complet d'upstream (configuration des binaires repris) |

Les dépôts sont récupérés en clone superficiel au commit exact (`fetch`), en extraction
partielle (« sparse ») quand seule une partie est utile. Avant chaque application des patches,
`prepare` remet chaque dépôt exactement à son commit (les fichiers ignorés comme
`node_modules` sont conservés, sauf avec `--clean`).

### Binaires repris (moteur)

| Cible | Fichier | Vérification |
|---|---|---|
| Linux x86_64 | `onlyoffice-desktopeditors_amd64.deb` (release v9.4.0) | SHA-256 `4271434e81be42b1…`, 364 644 136 octets |
| Windows x64 | `DesktopEditors_x64.zip` (release v9.4.0) | SHA-256 `22ae48a7813954e5…`, 598 575 987 octets |

Seuls les fichiers de l'archive vérifiée (manifeste écrit à l'extraction) entrent dans
l'arbre d'installation ; l'assemblage retire ce qu'AuxiNux remplace (shell, accueil,
éditeurs, service de mise à jour, modules réseau). Voir `scripts/auxibuild/assemble.py`.

## 2. Mécanismes de marque blanche d'upstream utilisés (sans patch)

| Mécanisme | Fichier généré par AuxiNux |
|---|---|
| `win-linux/src/prop/defines_p.h` (nom, chemins, clés de registre, mutex, protocole…) | `scripts/auxibuild/branding.py` |
| `win-linux/src/prop/version_p.h` (version, éditeur, copyright) | `branding.py` |
| ressources du shell (`res/icons/*`), images de l'accueil (`common/loginpage/res/img/*`) | `branding_web.py` (depuis `branding/generated/`) |
| variables d'environnement du `Gruntfile` de web-apps (`APP_TITLE_TEXT`, `PUBLISHER_*`, `PRODUCT_VERSION`…) | `branding_editors.py` |
| fichiers de langue des éditeurs (noms des éditeurs, textes À propos) | `branding_editors.py` |
| configuration de bureau des éditeurs (`api/documents/index.html.desktop` : aide, retour, commentaires) | `branding_editors.py` (s'arrête si un motif attendu a disparu) |

## 3. File de patches

Format : `patches/<dépôt>/NNNN-sujet.patch` (`git format-patch`), appliqués dans l'ordre avec
`git apply` ; un patch qui ne s'applique pas arrête le build. Chaque fichier upstream modifié
porte la mention « Modified by Projet AuxiNux on <date> for AuxiNux Office » (condition
additionnelle 2 de la licence d'upstream). Le code AuxiNux appelé par les patches vit dans
`src/shell/auxinux/` et `src/startpage/` (copié au build), pour garder les patches courts.

| Patch | Fichiers | Rôle |
|---|---|---|
| desktop-apps 0001 | `win-linux/defaults.pri` | compiler le module AuxiNux avec le shell |
| desktop-apps 0002 | `win-linux/src/main.cpp` | `--version`, réglages du moteur (cache, nom d'application), réglages de confidentialité avant l'initialisation du moteur |
| desktop-apps 0003 | `cascapplicationmanagerwrapper_private.h` | fichiers texte vers AuxiText, commande « Ouvrir PDF », nouveau fichier texte, nom du lanceur |
| desktop-apps 0004 | `cascapplicationmanagerwrapper.cpp`, `windows/cmainwindow.cpp` | pas de galerie de modèles en ligne (sauf `--templates-url`), pas de page d'inscription |
| desktop-apps 0005 | `prop/cmainwindowimpl.cpp` | informations AuxiNux et mentions légales de la fenêtre À propos |
| desktop-apps 0006 | `common/loginpage/*` | module d'accueil AuxiNux (six actions, À propos, pas de modèles en ligne) |
| desktop-apps 0007 | `win-linux/version.rc` | ressource de version Windows aux couleurs d'AuxiNux |
| desktop-apps 0008 | `platform_win/association.cpp` | « application par défaut » : ouvre les Paramètres Windows au lieu d'écrire `UserChoice` |
| desktop-apps 0009 | `win-linux/src/main.cpp` | traductions françaises des messages AuxiNux |
| desktop-apps 0010 | `win-linux/src/main.cpp` | Linux : arrêt standard sur SIGTERM (le gestionnaire du moteur plantait) |
| web-apps 0001 | `apps/common/main/lib/view/About.js` | mentions AuxiNux dans la fenêtre À propos des éditeurs |

Total : 11 patches, environ 140 lignes ajoutées au code d'upstream.

### Candidats à proposer à upstream

Pour réduire la file : 0008 (paramètres Windows plutôt que `UserChoice`), 0010 (ou mieux :
corriger dans desktop-sdk le gestionnaire SIGTERM, qui appelle du code non réentrant depuis
un gestionnaire de signal), 0007 (inclure `version_p.h` dans la ressource de version), et un
point d'extension générique pour les mentions des versions modifiées (0005, web-apps 0001).

## 4. Travailler sur un patch

```sh
python3 scripts/auxibuild fetch                          # sources aux commits épinglés
python3 scripts/auxibuild patches status                 # état des files
python3 scripts/auxibuild patches checkout desktop-apps  # worktree build/patch-dev/desktop-apps
cd build/patch-dev/desktop-apps                          # branche auxinux-dev = commit + patches
# … modifier, puis un commit par patch :
git -c user.name="Projet AuxiNux" -c user.email="repo@auxinux.ca" commit -a
python3 scripts/auxibuild patches export desktop-apps    # réécrit patches/desktop-apps/
python3 scripts/auxibuild prepare && python3 scripts/auxibuild build   # vérifier
```

Conventions : un commit = un patch = un sujet ; sujet en anglais préfixé (`shell:`,
`startpage:`, `editors:`) ; message expliquant le pourquoi ; trailer `Co-Authored-By` si
applicable ; mention « Modified by Projet AuxiNux on <date> » ajoutée en tête de tout nouveau
fichier upstream modifié ; tout code un peu long va dans `src/shell/auxinux/` plutôt que dans
le patch. Pour modifier un patch existant, faire un commit de correction puis le fusionner
dans le commit concerné (`git rebase --autosquash`, ou `git commit --amend` s'il s'agit du
dernier), puis `export`. `export` est idempotent : sans changement, les fichiers `.patch` restent
identiques octet pour octet.

## 5. Procédure de mise à jour vers une nouvelle version d'upstream

1. **Choisir la version** : lire le CHANGELOG et les notes de version d'upstream ; repérer le
   tag des sources (`vX.Y.Z.B`) et la release binaire correspondante.
2. **Mettre à jour le verrou** `upstream/upstream.lock.json` :
   - `upstream` : version, build, tags, date ;
   - `repositories.*.commit` : `git ls-remote https://github.com/ONLYOFFICE/<dépôt>.git refs/tags/vX.Y.Z.B` ;
   - `binaries.*` : URL, puis taille et SHA-256 calculés sur les fichiers téléchargés
     (`sha256sum`, `stat -c %s`) — ne jamais recopier une somme sans l'avoir calculée ;
   - vérifier les versions de Qt livrées par upstream (`toolchains.qt_*`) et l'ICU.
3. **Récupérer** : `python3 scripts/auxibuild fetch --target linux` puis `--target windows`.
4. **Rebaser les patches** : `patches checkout <dépôt>` pour chaque dépôt patché (voir §6 en
   cas de conflit), puis `patches export <dépôt>`.
5. **Construire et tester les deux cibles** : `./scripts/build-linux.sh --clean --release`,
   `python3 scripts/auxibuild all --target windows --accept-msvc-license --clean`, puis les
   scénarios de [TESTING-LINUX.md](TESTING-LINUX.md) et [TESTING-WINDOWS.md](TESTING-WINDOWS.md).
6. **Revoir ce qui a pu changer** :
   - licence d'upstream (`diff` du fichier `LICENSE` de desktop-apps) → [LICENSING.md](../LICENSING.md) ;
   - nouvelles communications réseau (l'audit réseau des tests échoue si une connexion
     apparaît), nouveaux modules (`privacy.removed_plugins`) → [PRIVACY.md](../PRIVACY.md) ;
   - textes « ONLYOFFICE » nouvellement visibles dans l'interface ;
   - nouvelles dépendances de compilation du shell (`doctor`).
7. **Documenter** : `product.json` (`upstream.version`), `NOTICE`, `CHANGELOG.md`, ce document.

## 6. Conflits

`prepare` s'arrête avec « le patch … ne s'applique pas sur … (conflit upstream ?) » quand le
code d'upstream a changé autour d'un patch. Résolution :

```sh
python3 scripts/auxibuild patches checkout desktop-apps
# git am s'arrête sur le patch en conflit, dans build/patch-dev/desktop-apps :
cd build/patch-dev/desktop-apps
git am --show-current-patch=diff                     # ce que le patch voulait faire
git am --show-current-patch=diff | git apply --reject  # applique ce qui passe, *.rej pour le reste
# … corriger les fichiers à la main (intention du patch), supprimer les *.rej
git add <fichiers> && git am --continue
cd - && python3 scripts/auxibuild patches export desktop-apps
```

Principes : réappliquer l'**intention** du patch sur le nouveau code (pas forcément les mêmes
lignes) ; si upstream a corrigé le problème ou fourni un point d'extension, **supprimer** le
patch ou le remplacer par du code AuxiNux ; garder chaque patch aussi petit que possible ;
documenter dans le CHANGELOG tout patch ajouté, modifié ou supprimé.

En cas d'échec des motifs de `branding_editors.py` (« motif introuvable ») : la configuration
de bureau des éditeurs a changé ; adapter le motif plutôt que d'ajouter un patch.
