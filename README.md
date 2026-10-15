# AuxiOffice

**AuxiOffice** ([office.auxinux.ca](https://office.auxinux.ca)) est la suite bureautique de
l'écosystème AuxiNux : traitement de texte, tableur et présentations, hors ligne, sans compte
et sans télémétrie, pour Linux, Windows et macOS.

| Application | Rôle | Formats |
|---|---|---|
| **AuxiWriter** | traitement de texte | DOCX, DOC, ODT, RTF, TXT ; export PDF |
| **AuxiSheet** | tableur | XLSX, XLS, ODS, CSV ; export PDF |
| **AuxiPresent** | présentations | PPTX, PPT, ODP ; export PDF |

AuxiOffice est un **produit propriétaire du Projet AuxiNux**. Son interface et sa coque sont
écrites par AuxiNux ; le rendu et l'édition des documents sont confiés à
**LibreOffice**, utilisé sans modification comme moteur, dans un processus séparé
(voir [ARCHITECTURE.md](ARCHITECTURE.md) et [LICENSING.md](LICENSING.md)).

> AuxiOffice remplace **AuxiNux Office** (fork AGPL d'ONLYOFFICE, abandonné). Le dernier état de
> ce produit reste disponible sous l'étiquette git `auxinux-office-0.1.0-final`.

## État : prototype 0.1.0

Vérifié sous Linux x86_64 (Debian 13, sous Xvfb) :

- ouverture, édition, enregistrement et export PDF de documents DOCX, XLSX et PPTX ;
- AuxiWriter : saisie, styles, polices, gras/italique…, listes, tableaux, images, sauts de page,
  suivi des modifications, nombre de pages et de mots ;
- AuxiSheet : saisie et formules, barre de formule, zone de nom, en-têtes de lignes et colonnes,
  onglets de feuilles, formats nombre/monétaire/pourcentage, tri, filtre, volets figés ;
- AuxiPresent : panneau des diapositives avec miniatures, ajout, duplication, suppression ;
- documents verrouillés par un autre utilisateur (lecture seule, ouverture forcée), verrous
  orphelins ;
- un moteur par document : un plantage de LibreOffice ne ferme que l'onglet concerné.

Pas encore fait : paquets, Windows (prévu mais non compilé), macOS (script prêt, pas encore
essayé sur un Mac), menus contextuels, boîtes de dialogue de LibreOffice (paragraphe, mise en
page…), diaporama, impression, rechercher-remplacer.

## Développement

Voir [BUILD.md](BUILD.md). En bref (Linux x86_64 ou Mac Apple Silicon) :

```sh
scripts/dev.sh                   # moteur LibreOffice, compilation, lancement
scripts/test.sh                  # tests de l'interface, du moteur et d'intégration
```
