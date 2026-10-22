# AuxiOffice

**AuxiOffice** ([office.auxinux.ca](https://office.auxinux.ca)) est la suite bureautique de
l'écosystème AuxiNux : traitement de texte, tableur, présentations, dessin et lecture de PDF,
hors ligne, sans compte et sans télémétrie, pour Linux, Windows et macOS.

Des applications séparées, chacune avec sa fenêtre, son icône et son entrée dans les
Applications (macOS) ou le menu de démarrage (Linux, Windows) :

| Application | Rôle | Formats |
|---|---|---|
| **AuxiOffice** | gestionnaire : créer, ouvrir, documents récents ; chaque document part dans son application | — |
| **AuxiWriter** | traitement de texte | DOCX, DOCM, DOC, ODT, RTF, TXT ; export PDF |
| **AuxiSheet** | tableur | XLSX, XLSM, XLS, ODS, CSV ; export PDF |
| **AuxiPresent** | présentations | PPTX, PPTM, PPT, ODP ; export PDF |
| **AuxiDraw** | dessin vectoriel et mise en page | ODG ; lecture de VSDX/VSD (Visio), CDR, PUB, SVG et PDF ; export PDF, PNG, SVG |
| **AuxiPDF** | lecteur de PDF : recherche, signets, miniatures, formulaires, annotations, impression | PDF |
| **AuxiText** | éditeur de texte, **installable seul** (sans LibreOffice ni le reste de la suite) ; éditeur par défaut d'AuxiNuxOS | texte brut, journaux, Markdown, JSON, XML, YAML, INI, TOML, scripts, code source |

AuxiText est une application à part (`text/`, paquet `auxitext`) : onglets, coloration
syntaxique, recherche et remplacement (expressions régulières), multi-curseurs, encodages
(UTF-8, UTF-16, Windows-1252, ISO-8859-…) et fins de ligne détectés et conservés,
enregistrement atomique, thème clair ou sombre qui suit le bureau. « Ouvrir dans AuxiWriter »
apparaît quand la suite est installée.

AuxiOffice est un **produit propriétaire du Projet AuxiNux**. Son interface et sa coque sont
écrites par AuxiNux ; le rendu et l'édition des documents sont confiés à
**LibreOffice**, utilisé sans modification comme moteur, dans un processus séparé
(voir [ARCHITECTURE.md](ARCHITECTURE.md) et [LICENSING.md](LICENSING.md)).

> AuxiOffice remplace **AuxiNux Office** (fork AGPL d'ONLYOFFICE, abandonné). Le dernier état de
> ce produit reste disponible sous l'étiquette git `auxinux-office-0.1.0-final`.

## État : bêta 0.2.0-beta.1

Vérifié sous Linux x86_64 ; Mac Apple Silicon : ouverture et édition vérifiées par
l'utilisateur. L'intégration continue (GitHub Actions, `.github/workflows/ci.yml`) compile et
teste chaque envoi sous Linux (avec le vrai moteur LibreOffice), macOS et Windows.

- ouverture, édition, enregistrement et export PDF de documents DOCX, XLSX et PPTX ;
- **barre de menus** native (Fichier, Édition, Affichage, Insertion, Format, Tableau ou
  Feuille/Données ou Diapositive, Outils) et **ruban à onglets** (Accueil, Insertion, Mise en
  page, Révision, Affichage…), adaptés au type de document ;
- **boîtes de dialogue de LibreOffice** dans AuxiOffice : Caractère, Paragraphe, Style de page
  (marges, orientation, en-tête et pied de page), Rechercher et remplacer, Puces et
  numérotation, Colonnes, Table des matières, Format de cellule, Tri, Filtre, Assistant
  fonction, Assistant diagramme, Formatage conditionnel, Propriétés de la diapositive… ;
- **menu contextuel** (clic droit) de LibreOffice, avec les suggestions d'orthographe ;
- **impression** (Ctrl+P) : imprimante, pages, copies, recto verso, noir et blanc (CUPS sous
  macOS et Linux), ou aperçu dans la visionneuse du système ;
- **diaporama** plein écran (F5), sans animations ni transitions ;
- **AuxiCorrect** corrige le français dans AuxiWriter quand il est installé (orthographe,
  grammaire, typographie, français québécois), avec son dictionnaire et ses options ;
- AuxiWriter, AuxiSheet, AuxiPresent : mise en forme courante, styles, listes, tableaux,
  images, barre de formule, en-têtes de lignes et colonnes, onglets de feuilles, miniatures
  de diapositives ;
- documents verrouillés, verrous orphelins ; un moteur par document, et un moteur prêt
  d'avance pour accélérer l'ouverture ;
- **AuxiDraw** : formes, lignes, connecteurs, courbes, cotes, texte, images ; disposition
  (plans, alignement, répartition, retournement, groupes, opérations sur les formes), pages
  et couches, grille ; modification des PDF ;
- **AuxiPDF** (PDF.js, sans LibreOffice) : miniatures, signets, recherche, zoom, rotation,
  mode présentation, formulaires, annotations (surlignage, texte, dessin, image),
  enregistrement, impression, document protégé par mot de passe ;
- glisser-déposer de fichiers sur les fenêtres.

Pas encore fait : moteur Windows (l'application compile sous Windows, mais LibreOffice n'y
est pas encore extrait ni testé comme moteur ; l'impression y passe par la visionneuse du
système), animations du diaporama, AuxiCorrect dans AuxiText.

## Développement

Voir [BUILD.md](BUILD.md). En bref (Linux x86_64 ou Mac Apple Silicon) :

```sh
scripts/dev.sh                   # moteur LibreOffice, compilation, lancement d'AuxiOffice
scripts/dev.sh --app writer      # … ou directement AuxiWriter (sheet, present, draw, pdf)
scripts/install-apps.sh          # les applications dans le Finder / le menu des applications
scripts/dev-text.sh [fichier]    # AuxiText seul (aucun moteur nécessaire)
scripts/test.sh                  # tests des interfaces, du moteur et d'intégration
```
