# AuxiNux Office sous macOS (Apple Silicon) — version préliminaire

Artefact : `dist/macos/AuxiNuxOffice-0.1.0-arm64.zip` (application `AuxiNux Office.app`,
macOS 11 Big Sur ou plus récent, processeurs Apple M1 et suivants).

La feuille de route prévoyait macOS en 0.4.x ; cette version **préliminaire** permet déjà de
l'utiliser et de le tester. Elle est construite autrement que les versions Linux et Windows :
lisez les limites (§3) avant de la diffuser.

## 1. Installation

1. Décompressez `AuxiNuxOffice-0.1.0-arm64.zip` (double-clic) et placez `AuxiNux Office.app`
   dans **Applications**.
2. L'application n'est pas signée par un certificat Apple Developer ni notarisée : macOS la
   bloque au premier lancement (« ne peut pas être ouverte… » ou « est endommagée »). Deux
   possibilités :
   - Terminal :
     ```sh
     xattr -dr com.apple.quarantine "/Applications/AuxiNux Office.app"
     ```
   - ou : tenter de l'ouvrir une fois, puis **Réglages Système > Confidentialité et sécurité >
     « Ouvrir quand même »**.
3. Lancez AuxiNux Office depuis le Launchpad ou le dossier Applications.

Données : `~/Library/Application Support/ca.auxinux.AuxiOffice/` ; réglages :
`~/Library/Preferences/ca.auxinux.AuxiOffice.plist` (distincts d'une éventuelle installation
d'ONLYOFFICE). Désinstallation : mettre l'application à la Corbeille (et, si souhaité, ces
deux emplacements).

## 2. Construction

### Sur votre Mac (recommandé)

```sh
git clone git@git.auxinux.ca:Auxinux/AuxiNux_Office.git
cd AuxiNux_Office
./build.sh --install
```

Le script vérifie les outils de ligne de commande d'Apple et Homebrew, installe Qt 5 et Node.js
avec Homebrew, construit l'application **avec AuxiText** (compilé sur le Mac, Qt intégré à
`AuxiText.app`), puis l'installe dans /Applications. Une application construite localement
n'est pas mise en quarantaine : aucune commande `xattr` n'est nécessaire. AuxiText est placé
dans `AuxiNux Office.app/Contents/Applications/AuxiText.app` ; la tuile « Nouveau fichier
texte » de l'accueil le lance (adresse `auxitext://new`), et il apparaît dans « Ouvrir avec »
pour les fichiers texte.

### Depuis Linux (sans AuxiText)


Le shell macOS d'upstream (Objective-C, `desktop-apps/macos`) ne peut être compilé qu'avec Xcode
et le SDK d'Apple. La version préliminaire est donc produite **depuis Linux**, sans compilation
macOS, en réempaquetant l'application d'upstream épinglée :

```sh
python3 scripts/auxibuild all --target macos --local-deps
```

| Étape | Effet |
|---|---|
| fetch | `ONLYOFFICE-arm.dmg` de la release 9.4.0 (SHA-256 et taille vérifiés, `upstream.lock.json`), extrait avec 7-Zip |
| prepare, build | page d'accueil et interface des éditeurs compilées depuis les sources patchées (mêmes que Linux/Windows) |
| assemble | remplacement de la page d'accueil, des éditeurs, des modules réseau ; identité (Info.plist, textes de toutes les langues, menus anglais, icônes de l'application et des types de documents) ; mentions légales ; Sparkle désactivé ; **re-signature** du bundle avec rcodesign 0.29.0 |
| test | identité, mentions légales, absence de logo ONLYOFFICE, textes, Sparkle, signature |
| package | `AuxiNuxOffice-0.1.0-arm64.zip` (liens symboliques et droits conservés), `SHA256SUMS`, `update-info.json` |

Signature : ad hoc par défaut. Avec un certificat **Developer ID Application** (compte Apple
Developer), définir `AUXI_MACOS_P12` (fichier .p12) et `AUXI_MACOS_P12_PASSWORD_FILE` : rcodesign
signe alors pour la notarisation (`--for-notarization`, runtime renforcé) ; la notarisation
elle-même (`rcodesign notary-submit`) demande une clé d'API App Store Connect.

## 3. Limites de la version préliminaire

| Sujet | État |
|---|---|
| Shell natif (fenêtres, menus, dialogues) | celui d'**upstream, non modifié** : les patches AuxiNux du shell (routage vers AuxiText, « Ouvrir PDF » avec filtre, réglages appliqués avant le moteur, arrêt sur SIGTERM, traductions) ne s'appliquent pas |
| AuxiText | inclus quand l'application est construite **sur un Mac** (`./build.sh`) ; absent des builds faits depuis Linux (tuile « Nouveau fichier texte » alors masquée) |
| « Ouvrir PDF » | ouvre le dialogue d'ouverture standard (tous types) |
| Assistant IA | désactivé par l'écran d'accueil au premier lancement (l'option reste dans les paramètres) |
| Réglages réseau du moteur web (DNS sur HTTPS, réseau d'arrière-plan) | **non appliqués** (pas de lanceur AuxiNux sous macOS) : à vérifier (§4) |
| Mises à jour (Sparkle) | vérifications automatiques désactivées, flux supprimé ; le menu « Rechercher des mises à jour » affichera une erreur |
| Menu Aide | ouvre le site AuxiNux (adresses d'ONLYOFFICE remplacées dans le shell) |
| Logo de l'onglet d'accueil | entrées du catalogue compilé `Assets.car` neutralisées pour que macOS charge les images AuxiNux : à vérifier (§4) |
| Signature | ad hoc, non notarisée (§1) |

Ces limites disparaîtront avec la compilation du shell macOS dans Xcode (patches AuxiNux,
`Assets.car` et AuxiText compilés), prévue à la feuille de route.

## 4. Plan de test (sur Mac Apple Silicon)

| ID | Étapes | Résultat attendu |
|---|---|---|
| M-1 | Installation (§1), premier lancement | l'application démarre ; nom « AuxiNux Office » dans la barre des menus |
| M-2 | Menus AuxiNux Office (À propos, Masquer, Quitter) en français et en anglais | « AuxiNux Office » partout ; fenêtre À propos : version 0.1.0, copyright Projet AuxiNux |
| M-3 | Icônes : Finder, Launchpad, Dock, fichiers DOCX/XLSX/PPTX/PDF | icônes AuxiNux ; noter les éventuelles icônes ONLYOFFICE (Dock pendant l'exécution, onglet d'accueil) |
| M-4 | Écran d'accueil ; tuile « Nouveau fichier texte » | « Bienvenue dans AuxiNux Office ! », six tuiles (cinq si construit depuis Linux) ; la tuile ouvre AuxiText |
| M-5 | DOCX, XLSX, PPTX : créer, ouvrir, modifier, enregistrer, exporter en PDF | fonctionnel |
| M-6 | PDF : ouvrir, naviguer, zoomer, rechercher, copier | fonctionnel |
| M-7 | Double-clic sur des documents dans le Finder ; Ouvrir avec | AuxiNux Office proposé ; l'application par défaut existante n'est pas modifiée |
| M-8 | Paramètres de l'accueil : IA | désactivée après le premier lancement (redémarrer l'application une fois) |
| M-9 | Réseau : application ouverte avec des documents, dans Moniteur d'activité > Réseau, ou `sudo lsof -i -P \| grep -i auxinux`, ou Little Snitch / LuLu | noter toute connexion sortante (en particulier vers dns.google ou Cloudflare) |
| M-10 | À propos > Logiciels libres et licences (écran d'accueil) | mentions AuxiNux, liens vers LICENSE, NOTICE et licences tierces |

Merci de signaler les résultats (captures bienvenues), en particulier M-3 et M-9.
