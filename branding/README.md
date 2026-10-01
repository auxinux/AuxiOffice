# Identité visuelle d'AuxiNux Office

Toute l'identité du produit est centralisée ici et appliquée **automatiquement** au build
(étape `prepare`) : aucun fichier d'upstream n'est modifié à la main.

```text
branding/
  product.json            description du produit (source de vérité de l'identité)
  generated/              ressources générées et versionnées (svg, png, ico, bmp)
  tools/generate_assets.py  générateur des ressources
  fonts/                  Carlito Bold Italic (SIL OFL 1.1), contours des lettres des logos
```

## product.json

| Section | Contenu |
|---|---|
| `product` | nom (« AuxiNux Office »), nom court (« AuxiOffice »), éditeur, titulaire du copyright, site, dépôt source, licence, date de début des modifications, descriptions FR/EN |
| `upstream` | programme d'origine, développeur, mentions de marque FR/EN (affichées dans l'application et les paquets) |
| `apps` | AuxiWriter, AuxiSheet, AuxiPresent, AuxiPDF, AuxiText (et AuxiMail, « study ») : nom, couleur, lettre, extensions |
| `linux` | exécutable, nom du paquet, identifiant d'application (`ca.auxinux.AuxiOffice`), dossiers, mainteneur |
| `windows` | exécutables, dossier d'installation, clés de registre, identifiant d'application (AppUserModelID), préfixe des ProgID, code de mise à niveau MSI |
| `colors` | orange AuxiNux `#F26F00`, ambre `#F2B713`, graphite `#23252A`, argent `#B7B9BA`, fonds clair et sombre |
| `i18n` | langue par défaut (français) et langues livrées |
| `updates` | réglages du futur système de mises à jour ([docs/UPDATES.md](../docs/UPDATES.md)) |
| `privacy` | modules réseau retirés, assistant IA désactivé par défaut ([PRIVACY.md](../PRIVACY.md)) |

## Ressources générées

`generated/` contient, régénérés depuis `product.json` :

| Dossier | Contenu | Utilisation |
|---|---|---|
| `svg/` | icônes des applications (`auxioffice`, `auxiwriter`…), icônes de types de fichiers (`mime-*`), logos clair/sombre, logo de la barre de titre, illustrations de l'accueil, écran de démarrage | sources vectorielles ; icônes `scalable` Linux ; page d'accueil |
| `png/<taille>/` | icônes aux tailles 16 à 512 | icônes hicolor Linux, AppImage |
| `png/` | logos, logo du shell (1× à 2×), écran de démarrage, illustrations | shell, page d'accueil |
| `ico/` | icônes Windows multirésolutions | `auxioffice.exe` (ressources 1 à 11), AuxiText, shell, installateurs |
| `bmp/` | en-tête (150×57) et bandeau (164×314) | installateur NSIS |

Régénérer (outil de mainteneur, après modification de `product.json` ou du générateur) :

```sh
python3 -m pip install fonttools cairosvg pillow
python3 branding/tools/generate_assets.py
```

Les ressources générées sont versionnées pour que le build n'ait pas besoin de ces outils.

## Application au build

- `scripts/auxibuild/branding.py` : en-têtes de marque blanche du shell (`defines_p.h`,
  `version_p.h`, `auxinux_branding.h`) ;
- `scripts/auxibuild/branding_web.py` : logos et icônes du shell, images et module de la page
  d'accueil ;
- `scripts/auxibuild/branding_editors.py` : nom des éditeurs, mentions À propos, configuration
  de bureau des éditeurs ;
- `scripts/auxibuild/package_*.py` : fichiers `.desktop`, AppStream, icônes, installateurs.

## Règles

- Ne jamais réutiliser le logo, les couleurs ou l'identité visuelle d'ONLYOFFICE ; conserver
  les mentions légales et d'origine exigées par la licence ([LICENSING.md](../LICENSING.md)).
- Une version dérivée distribuée par un tiers doit remplacer les noms et logos AuxiNux :
  modifier `product.json`, régénérer les ressources, reconstruire.
- Icônes des types de fichiers : utilisées sous Windows ; sous Linux, laissées au thème
  d'icônes de l'utilisateur (voir [ARCHITECTURE.md](../ARCHITECTURE.md)).
- Licences : identité AuxiNux sous CC BY-SA 4.0 (noms et logos : signes distinctifs du projet) ;
  Carlito sous SIL OFL 1.1 (`fonts/OFL-1.1.txt`).
