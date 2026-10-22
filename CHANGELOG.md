# Journal des modifications

## 0.2.0-beta.1 — AuxiText

- **AuxiText**, éditeur de texte de l'écosystème, installable seul (paquet `auxitext`, sans
  LibreOffice ni le reste de la suite), éditeur par défaut d'AuxiNuxOS. Tauri 2 +
  CodeMirror 6 :
  - onglets et plusieurs fenêtres, Nouveau, Ouvrir, fichiers récents, Enregistrer,
    Enregistrer sous, Enregistrer tout, Recharger, Fermer ; question avant de perdre des
    modifications (onglet, fenêtre, Quitter) ;
  - coloration syntaxique d'une trentaine de langages (Markdown, JSON, XML, HTML, CSS,
    JavaScript, TypeScript, Python, Rust, C/C++, Java, PHP, SQL, YAML, Go, shell, INI,
    TOML, diff, Dockerfile, Makefile, CMake, journaux…), détectée par le nom du fichier ou sa
    première ligne ;
  - rechercher et remplacer (casse, mot entier, expressions régulières avec groupes), aller à
    la ligne, multi-curseurs, pliage, mise en évidence de la ligne et des parenthèses,
    commenter, dupliquer, déplacer, trier les lignes, majuscules et minuscules ;
  - encodage détecté (BOM, UTF-8, UTF-16, Windows-1252 et autres encodages 8 bits) et fins de
    ligne (LF, CRLF, CR) conservées octet pour octet ; changement d'encodage et de fins de
    ligne, réouverture avec un autre encodage ; fichiers binaires refusés, confirmation
    au-delà de 50 Mo ;
  - enregistrement atomique (fichier temporaire puis renommage, droits conservés) ;
  - fichier modifié ou supprimé par un autre programme signalé (Recharger, Ignorer) ;
  - instance unique : un second lancement transmet ses fichiers à la fenêtre ouverte ;
    glisser-déposer de fichiers ;
  - barre d'état (ligne, colonne, sélection, langage, indentation, encodage, fins de ligne,
    état) ; thème clair ou sombre qui suit le bureau (KDE, GTK) ou forcé ; préférences
    (police, taille, zoom, retour à la ligne, numéros, espaces visibles, indentation) ;
  - impression ; « Ouvrir dans AuxiWriter » quand la suite est installée.
- Version du dépôt : 0.2.0-beta.1.

## Non publié

- **AuxiCorrect dans AuxiWriter** : quand AuxiCorrect est installé et AuxiOffice activé dans
  son onglet Intégration (`auxicorrect.json`), c'est lui qui corrige le français, à la place
  du correcteur de LibreOffice : soulignements (orthographe en rouge, grammaire, typographie
  et particularités régionales en orange, style en bleu), message et suggestions au clic
  droit, boîte « Vérifier le document ». Outils → AuxiCorrect et onglet Révision : Vérifier
  le document, Dictionnaire (définitions, synonymes, antonymes, conjugaison), Options
  (profil québécois ou international, variante orthographique, particularités régionales,
  style). Indicateur « ✓ AuxiCorrect » dans la barre d'état.
- Documents vierges et langue par défaut en français du Canada (les modèles étaient en
  anglais : le français était vérifié avec le dictionnaire anglais).
- Messages et boîtes de LibreOffice au nom d'AuxiOffice ; la croix des boîtes de dialogue
  les ferme ; AuxiOffice ouvre AuxiWriter, AuxiSheet et AuxiPresent installés dans
  ~/Applications même lancé par `scripts/dev.sh`.
- **Quatre applications** : AuxiOffice (gestionnaire) et AuxiWriter, AuxiSheet, AuxiPresent,
  chacune avec sa fenêtre, son icône, son accueil, ses documents récents et ses menus ; un
  document d'un autre type part dans son application ; une seule instance par application
  (un second lancement est transmis à la fenêtre ouverte) ; fichiers ouverts depuis le Finder.
  `scripts/install-apps.sh` les installe dans `~/Applications` (macOS) ou le menu des
  applications (Linux). L'exécutable trouve seul le moteur du dépôt.
- Fermeture de la fenêtre corrigée (permission manquante) ; le moteur quitte sans
  « Unspecified Application Error » ; `make` du moteur macOS écrit dans un journal.
- Impression (Ctrl+P) : imprimante, pages, copies, recto verso, noir et blanc, via CUPS
  (macOS, Linux) ; « Aperçu du système… » ouvre le PDF dans la visionneuse du système.
- Une centaine de fonctions de LibreOffice de plus dans les menus et le ruban, chacune
  vérifiée sur le moteur : collage spécial, propriétés du document, langue du document ou
  du paragraphe, suivi des modifications, Fontwork, QR code, formules, renvois, index,
  enveloppes ; dans le tableur, table dynamique, sous-totaux, consolidation, valeur cible,
  formatage conditionnel, zones d'impression, protection, statistiques, audit ; dans les
  présentations, mises en page, formes, champs, masquer ou renommer une diapositive.
- Diaporama plein écran (F5, Maj+F5 depuis la diapositive courante ; flèches, espace,
  clic, Échap). Les animations et transitions ne sont pas jouées.
- Un profil LibreOffice par moteur (le moteur prêt d'avance n'en partage plus) ; le dossier
  `crash` laissé par un plantage, qui bloquait ensuite l'export PDF, est supprimé au
  démarrage ; les verrous orphelins laissés par un autre moteur d'AuxiOffice sont retirés.
- Barre de menus native et ruban à onglets, construits depuis un catalogue de commandes
  vérifiées une à une avec LibreOffice (aucune ne fait planter le moteur).
- Boîtes de dialogue de LibreOffice affichées et pilotées dans AuxiOffice (rendu net sur
  écrans haute densité, souris, clavier, listes déroulantes, déplacement).
- Menu contextuel de LibreOffice au clic droit.
- Moteur prêt d'avance ; `dev.sh` compile en mode optimisé.

- Moteur LibreOffice 26.8.1 (le rendu par tuiles sous macOS n'existe qu'à partir de 26.8) ;
  liaison `lok-sys` réalignée sur les tables de fonctions de 26.8 et contrôle de leur taille
  au démarrage.
- macOS : le LibreOffice officiel ne peut pas dessiner les pages pour un autre programme
  (pas de module svp) ; `scripts/build-engine-macos.sh` compile le moteur avec
  `--enable-headless`, qui fonctionne alors comme sous Linux. Le moteur ne reçoit plus
  d'arguments (LibreOffice lit ceux du processus sous macOS).
- Diagnostic : `scripts/diagnose.sh`, erreurs de démarrage du moteur détaillées, journal.
- « Enregistrer » ne bloque plus le moteur : réponse différée à la fin de `.uno:Save`.
- `fetch-engine.sh` : reprise des téléchargements coupés, modules de langue facultatifs,
  réinstallation propre ; `dev.sh` retélécharge le moteur quand la version épinglée change.

## 0.1.0 — prototype (2026-10-15)

Nouveau départ : AuxiOffice remplace AuxiNux Office (fork AGPL d'ONLYOFFICE).

- Moteur LibreOffice 26.2.6 (binaires officiels épinglés, `scripts/fetch-engine.sh`), piloté
  par LibreOfficeKit dans un processus `auxi-engine` par document.
- Interface maison (Tauri 2, React, TypeScript) : accueil, documents récents, onglets,
  rendu par tuiles, curseur et sélection, clavier, méthodes de saisie, presse-papiers.
- AuxiWriter, AuxiSheet, AuxiPresent : barres d'outils, barre de formule et en-têtes du
  tableur, onglets de feuilles, panneau des diapositives.
- Enregistrer, Enregistrer sous (changement d'emplacement et de format), export PDF,
  nouveaux documents depuis des modèles DOCX/XLSX/PPTX.
- Verrous de fichiers : lecture seule signalée, ouverture forcée, verrous orphelins retirés.
- Tests : protocole, conversions, intégration avec LibreOffice (Writer, Calc, Impress,
  verrous, enregistrement), tests de l'interface.
