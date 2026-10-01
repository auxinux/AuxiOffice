# Contribuer à AuxiNux Office

Merci de votre intérêt ! AuxiNux Office est un logiciel libre ; les contributions (code,
traductions, tests, documentation, signalements) sont les bienvenues.

## Principes

Avant de proposer une modification, vérifiez qu'elle respecte les priorités du projet :
maintenabilité, simplicité, **patches upstream minimaux**, automatisation, code commun Linux
et Windows, sécurité, **confidentialité** (aucune télémétrie, aucune communication réseau
automatique non documentée), documentation. Une fonction qui ne peut pas être terminée est
documentée comme telle, jamais présentée comme fonctionnelle.

## Mettre en place l'environnement

```sh
git clone <dépôt AuxiNux Office>
cd AuxiNux_Office
python3 scripts/auxibuild doctor            # dépendances (voir BUILD.md)
./scripts/build-linux.sh --release --local-deps
```

Itérations rapides : `python3 scripts/auxibuild build --components shell` (ou `js`,
`auxitext`, `launcher`), puis `assemble` et `test`.

## Où modifier quoi

| Modification | Où |
|---|---|
| Nom, éditeur, URL, couleurs, types de fichiers, identifiants | `branding/product.json` (+ `branding/tools/generate_assets.py` pour les images) |
| Comportement du shell | de préférence `src/shell/auxinux/` ; sinon un patch court dans `patches/desktop-apps/` |
| Écran d'accueil | `src/startpage/auxinux.js` |
| Textes des éditeurs | `scripts/auxibuild/branding_editors.py` ; patch `patches/web-apps/` en dernier recours |
| AuxiText | `src/auxitext/` (+ `tests/auxitext/`) |
| Lanceur | `src/launcher/auxioffice.c` |
| Paquets | `scripts/auxibuild/package_*.py`, `packaging/` |
| Version | `VERSION` uniquement |

Les patches upstream suivent la procédure de [docs/UPSTREAM.md](docs/UPSTREAM.md) :
`auxibuild patches checkout <dépôt>`, un commit par patch, `auxibuild patches export <dépôt>`.
Ne modifiez jamais les fichiers `.patch` à la main.

## Conventions

- **Langue** : interface et documentation en français (langue principale) avec équivalent
  anglais pour les textes visibles ; commentaires du code AuxiNux en français ; messages des
  patches upstream en anglais (ils peuvent être proposés à upstream).
- **En-têtes** : tout nouveau fichier porte `SPDX-License-Identifier: AGPL-3.0-or-later` et
  `Copyright (C) <année> Projet AuxiNux` ; tout fichier upstream modifié porte la mention
  datée « Modified by Projet AuxiNux on <date> for AuxiNux Office ».
- **Style** : celui du code environnant (Qt/C++ : style du shell d'upstream ; C : C99 ;
  Python : PEP 8, bibliothèque standard uniquement dans l'orchestrateur ; JavaScript : style
  de la page d'accueil).
- **Commits** : messages explicites (quoi et pourquoi), une modification logique par commit.
- **Typographie française** dans l'interface : espaces insécables avant `: ; ! ?`,
  guillemets « », apostrophes typographiques si possible.

## Tests

Toute modification doit passer `python3 scripts/auxibuild test --target linux` ; une
correction de bogue ajoute un test qui l'aurait détecté (tests unitaires d'AuxiText,
scénarios graphiques de `tests/smoke/`, contrôles de `scripts/auxibuild/testing.py`). Les
modifications visibles sous Windows sont vérifiées avec les scénarios de
[docs/TESTING-WINDOWS.md](docs/TESTING-WINDOWS.md). Ne déclarez jamais un test réussi sans
l'avoir exécuté.

## Traductions

AuxiText : `src/auxitext/i18n/auxitext_<langue>.ts` (Qt Linguist) ; écran d'accueil : objets
de langue de `src/startpage/auxinux.js` ; textes ajoutés aux éditeurs :
`scripts/auxibuild/branding_editors.py` ; messages du shell : traducteur de
`src/shell/auxinux/auxinux.cpp`. Les autres textes viennent d'upstream (traductions
ONLYOFFICE).

## Signaler un problème

- Bogue : version (`auxioffice --version`), système, étapes pour reproduire, résultat
  attendu et obtenu, document d'exemple si possible (sans données personnelles).
- **Sécurité ou confidentialité** : ne pas publier de détails exploitables ; écrire au
  mainteneur (voir [AUTHORS](AUTHORS)) en décrivant le problème ; une réponse et un correctif
  sont coordonnés avant publication.

## Licence des contributions

En contribuant, vous acceptez que votre contribution soit publiée sous AGPL-3.0-or-later
(code) ou CC BY-SA 4.0 (ressources non logicielles) — voir [LICENSING.md](LICENSING.md).
