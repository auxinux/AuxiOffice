# Plan de test — Linux

Cibles : **Debian 13**, **Ubuntu 24.04 LTS** (ou plus récent) et **AuxiNux OS**, x86_64.
Artefacts : `auxinux-office_0.1.0_amd64.deb`, `AuxiNuxOffice-0.1.0-x86_64.AppImage`.

Le cahier des charges de la 0.1.0 est rempli quand tous les scénarios **obligatoires** (O)
passent sur Linux (et ceux de [TESTING-WINDOWS.md](TESTING-WINDOWS.md) sur Windows).
Notez pour chaque campagne : distribution et version, environnement de bureau, session X11 ou
Wayland, langue, artefact testé et sa somme SHA-256.

## 1. Tests automatiques

```sh
python3 scripts/auxibuild test --target linux        # après build + assemble
```

Prérequis : `xvfb`, `xdotool`, `strace` (voir [BUILD.md](../BUILD.md)). Rapport :
`build/test-reports/linux/report.md` (+ `report.json`, captures `gui/*.png`, journaux).

| Groupe | Vérifications |
|---|---|
| Versions | `auxioffice --version`, `auxitext --version`, `auxioffice-editors --version` affichent `AuxiNux Office 0.1.0` / `AuxiText 0.1.0` |
| AuxiText (unitaires) | 19 tests : décodage/encodage, BOM, UTF-16, Latin-1, fins de ligne CRLF/LF/CR, détection, conversions sans perte |
| Statiques | identité de la page d'accueil, mentions légales installées, NOTICE, modules réseau retirés, service de mise à jour absent |
| Graphiques (Xvfb, sans réseau) | accueil et répertoires XDG, IA désactivée par défaut ; DOCX ouvrir/modifier/enregistrer + métadonnée « AuxiNux Office » ; XLSX modification + formules recalculées ; PPTX titre modifié + nouvelle diapositive ; PDF ouvert + recherche ; AuxiText (CRLF et UTF-8 conservés, Markdown, fichier sans extension) ; AuxiText intégré (fichier texte transmis à l'instance ouverte et tuile « Nouveau fichier texte » dans un onglet, enregistrement) ; arrêt par SIGTERM sans plantage ; audit réseau avec documents piégés |
| Réseau | session complète sous `strace` : aucune connexion sortante (hors 127.0.0.0/8 et ::1) |
| Conversions (x2t) | DOCX/XLSX/PPTX → PDF (texte vérifié), → ODT/ODS/ODP, CSV → XLSX, DOCX → RTF/TXT, ODT → DOCX aller-retour |

## 2. Installation (O)

| ID | Étapes | Résultat attendu |
|---|---|---|
| L-INS-1 | `sudo apt install ./auxinux-office_0.1.0_amd64.deb` sur un système à jour | dépendances résolues par APT, aucune erreur ; `dpkg -s auxinux-office` : version 0.1.0 |
| L-INS-2 | `auxioffice --version` ; `auxitext --version` | `AuxiNux Office 0.1.0` ; `AuxiText 0.1.0 (AuxiNux Office)` |
| L-INS-3 | Menu des applications | entrées AuxiNux Office, AuxiWriter, AuxiSheet, AuxiPresent, AuxiPDF, AuxiText avec leurs icônes ; « Nouveau document/feuille/présentation/fichier texte » dans le menu contextuel de l'entrée principale |
| L-INS-4 | `ls /usr/lib/auxinux-office` ; `ls -l /usr/bin/auxioffice /usr/bin/auxitext` | arborescence décrite dans ARCHITECTURE.md ; liens vers `/usr/lib/auxinux-office` |
| L-INS-5 | AppImage : `chmod +x` puis lancement, et `./AuxiNuxOffice-0.1.0-x86_64.AppImage --version` | écran d'accueil ; `AuxiNux Office 0.1.0` |
| L-INS-6 | `sudo apt remove auxinux-office` puis `sudo apt purge auxinux-office` | fichiers de `/usr/lib/auxinux-office`, menus et icônes supprimés ; `~/.config/auxinux-office` et `~/.local/share/auxinux-office` conservés |

## 3. Écran d'accueil (O)

| ID | Étapes | Résultat attendu |
|---|---|---|
| L-ACC-1 | Lancer AuxiNux Office (menu ou `auxioffice`) | « Bienvenue dans AuxiNux Office ! », six actions : Nouveau document, Nouvelle feuille de calcul, Nouvelle présentation, Ouvrir PDF, Nouveau fichier texte, Ouvrir un fichier |
| L-ACC-2 | Chaque action | ouvre respectivement AuxiWriter, AuxiSheet, AuxiPresent, le dialogue « Documents PDF », AuxiText (nouveau fichier), le dialogue d'ouverture |
| L-ACC-3 | Ouvrir puis fermer trois documents | ils apparaissent dans les documents récents (stockés dans `~/.local/share/auxinux-office`) ; « Effacer » vide la liste |
| L-ACC-4 | À propos | nom, version 0.1.0, section « Logiciels libres et licences » (basé sur ONLYOFFICE Desktop Editors 9.4.0, projet indépendant, version modifiée depuis 2026-10-01, licence, marque) ; liens LICENSE.txt, NOTICE.txt, licences tierces |
| L-ACC-5 | Paramètres > langue anglais, redémarrer ; revenir au français | interface entièrement en anglais puis en français |
| L-ACC-6 | Paramètres | pas d'assistant IA actif par défaut ; aucun compte demandé |

## 4. AuxiWriter (O)

| ID | Étapes | Résultat attendu |
|---|---|---|
| L-WRI-1 | Ouvrir un DOCX réel (Word) avec styles, tableaux, images, en-têtes/pieds, numéros de page, notes, commentaires | rendu fidèle |
| L-WRI-2 | Gras, italique, souligné, polices, tailles, couleurs, styles, titres, listes à puces/numérotées, tableau, image, en-tête/pied, numéros de page, commentaires, suivi des modifications | fonctions disponibles et appliquées |
| L-WRI-3 | Rechercher/remplacer ; correcteur orthographique (français) | remplacements effectués ; fautes soulignées, suggestions françaises |
| L-WRI-4 | Enregistrer (DOCX), fermer, rouvrir ; ouvrir aussi dans un autre logiciel si disponible | modifications conservées ; fichier lisible |
| L-WRI-5 | Ouvrir et enregistrer sous DOC, ODT, RTF, TXT, HTML | conversion sans erreur bloquante |
| L-WRI-6 | Fichier > Télécharger/Enregistrer sous > PDF | PDF fidèle |
| L-WRI-7 | Imprimer (imprimante réelle ou PDF via CUPS) | aperçu et impression corrects |

## 5. AuxiSheet (O)

| ID | Étapes | Résultat attendu |
|---|---|---|
| L-SHE-1 | Ouvrir un XLSX réel (plusieurs feuilles, formules, mise en forme conditionnelle, graphiques) | rendu fidèle, formules recalculées |
| L-SHE-2 | Formules : SOMME, MOYENNE, SI, RECHERCHEV, références entre feuilles | résultats exacts (séparateur décimal selon la langue) |
| L-SHE-3 | Trier, filtrer (filtre automatique), créer un graphique | fonctions opérationnelles |
| L-SHE-4 | Importer un CSV (séparateur `;` et `,`, UTF-8 et Windows-1252) | dialogue d'import, colonnes et accents corrects |
| L-SHE-5 | Exporter en CSV ; enregistrer en XLSX, XLS, ODS | fichiers corrects |

## 6. AuxiPresent (O)

| ID | Étapes | Résultat attendu |
|---|---|---|
| L-PRE-1 | Ouvrir un PPTX réel ; PPT ; ODP | rendu fidèle |
| L-PRE-2 | Ajouter/dupliquer/supprimer/réordonner des diapositives ; thème ; transitions | fonctions opérationnelles |
| L-PRE-3 | Diaporama (F5), mode présentateur, notes | plein écran, navigation, notes visibles en mode présentateur |
| L-PRE-4 | Imprimer ; exporter en PDF ; enregistrer en PPTX/ODP | fichiers corrects |

## 7. AuxiPDF (O)

| ID | Étapes | Résultat attendu |
|---|---|---|
| L-PDF-1 | Accueil > Ouvrir PDF, ou `auxioffice document.pdf` | le PDF s'ouvre dans AuxiPDF |
| L-PDF-2 | Navigation entre pages, miniatures, zoom (+/−, ajuster à la page/largeur) | fonctionnel |
| L-PDF-3 | Rechercher un mot ; sélectionner et copier du texte | occurrences trouvées ; texte collé correct |
| L-PDF-4 | Faire pivoter ; imprimer | rotation et impression correctes |

## 8. AuxiText (O)

| ID | Étapes | Résultat attendu |
|---|---|---|
| L-TXT-1 | Nouveau, Ouvrir, Enregistrer, Enregistrer sous | fonctionnel |
| L-TXT-2 | Ouvrir des fichiers TXT, LOG, MD, CSV, JSON, XML, YAML, YML, INI, CONF, sans extension | ouverts dans AuxiText (un CSV ouvert par double-clic ou `auxioffice` va dans AuxiSheet ; depuis AuxiText, il s'ouvre en texte) ; coloration JSON/XML/YAML/MD/INI |
| L-TXT-3 | Fichier CRLF (Windows) modifié puis enregistré ; fichier LF | fins de ligne conservées ; indicateur CRLF/LF correct ; conversion possible par le menu |
| L-TXT-4 | Fichier UTF-8 avec accents, UTF-8 avec BOM, Latin-1 | accents corrects ; encodage indiqué et conservé |
| L-TXT-5 | Rechercher/remplacer (expressions régulières, casse, mots entiers), aller à la ligne | fonctionnel ; « Tout remplacer » annulable en une fois |
| L-TXT-6 | Numéros de ligne, retour à la ligne, zoom, thème clair/sombre | fonctionnel |
| L-TXT-7 | Modifier le fichier ouvert depuis un autre programme | AuxiText propose de recharger |
| L-TXT-8 | Fichier > Ouvrir dans AuxiWriter | le fichier s'ouvre dans AuxiWriter |
| L-TXT-9 | AuxiNux Office ouvert : tuile « Nouveau fichier texte » ; « Ouvrir un fichier » sur un `.txt` ; glisser un `.md` sur la fenêtre | onglet AuxiText dans AuxiNux Office (menus Fichier, Édition, Affichage, Document, Aide ; barre d'état), pas de fenêtre séparée ; un fichier déjà ouvert active son onglet |
| L-TXT-10 | Onglet texte modifié : Ctrl+S ; puis modifier et fermer l'onglet (Oui / Non / Annuler) ; fermer la fenêtre avec un onglet texte modifié | enregistré ; le message « Enregistrer les modifications ? » d'AuxiNux Office enregistre, abandonne ou annule ; aucune perte |
| L-TXT-11 | Thème sombre d'AuxiNux Office (Paramètres), puis afficher un onglet texte ; tenter de détacher l'onglet (glisser hors de la barre) | l'onglet suit le thème ; l'onglet reste dans la fenêtre principale |

## 9. Intégration au bureau (O)

| ID | Étapes | Résultat attendu |
|---|---|---|
| L-DES-1 | Double-clic sur DOCX, XLSX, PPTX, PDF, TXT, MD dans le gestionnaire de fichiers | application AuxiNux adaptée (si elle est l'application choisie) |
| L-DES-2 | Clic droit > Ouvrir avec | AuxiNux Office / AuxiWriter / AuxiSheet / AuxiPresent / AuxiPDF / AuxiText proposés |
| L-DES-3 | `xdg-mime query default application/vnd.openxmlformats-officedocument.wordprocessingml.document` avant/après installation, avec un autre logiciel déjà choisi | le choix existant de l'utilisateur n'est pas modifié |
| L-DES-4 | Lancer un second document alors que l'application est ouverte | ouvert dans l'instance existante |
| L-DES-5 | Fermer la session avec AuxiNux Office ouvert | aucun rapport de plantage (apport, systemd-coredump) |

## 10. Confidentialité (O)

| ID | Étapes | Résultat attendu |
|---|---|---|
| L-PRI-1 | Sans réseau (`unshare -Un auxioffice` ou réseau coupé) : scénarios 3 à 8 | tout fonctionne |
| L-PRI-2 | `strace -f -e trace=connect -o net.log auxioffice`, ouvrir un document de chaque type | aucune connexion hors 127.0.0.1/::1 (voir PRIVACY.md) |
| L-PRI-3 | Vérifier `~/.config/auxinux-office`, `~/.local/share/auxinux-office`, `~/.cache/auxinux-office` | seuls ces répertoires sont créés |

## 11. Robustesse (recommandé)

Documents volumineux (100 pages, 50 000 lignes), plusieurs fenêtres, écrans HiDPI (125 %,
200 %), session Wayland (XWayland), GNOME et KDE, utilisation prolongée.

## 12. Résultats pour la version 0.1.0

Hôte : Debian 13 (trixie) x86_64, build complet depuis zéro (`./scripts/build-linux.sh --clean
--release --local-deps`), 2026-10-02.

- **Tests automatiques : 40 sur 40 réussis** (`build/test-reports/linux/report.md`) :
  contrôles statiques (dont « aucun logo ONLYOFFICE dans l'interface »), versions, 19 tests
  unitaires d'AuxiText, tests graphiques sous Xvfb dans un espace de noms réseau isolé (accueil,
  DOCX, XLSX avec formules, PPTX, PDF avec recherche, AuxiText CRLF/UTF-8/Markdown/sans
  extension, arrêt par SIGTERM sans plantage), **0 tentative de connexion réseau**, 10
  conversions x2t.
- **Paquet `.deb`** : sommes SHA-256 vérifiées ; installation simulée par APT sur Debian 13
  (`apt-get -s install ./auxinux-office_0.1.0_amd64.deb`) : toutes les dépendances satisfaites ;
  arbre extrait : `auxioffice --version`, `auxitext --version`, `auxioffice-editors --version`
  corrects.
- **AppImage** : `--version` correct ; lancée (extraite) sous Xvfb avec un profil neuf et sans
  réseau : ouverture d'un DOCX dans AuxiWriter, répertoires XDG créés, arrêt propre sans
  core dump.
- **Vérifié manuellement sous Xvfb** : accueil, À propos et mentions légales, documents
  récents, dialogue « Ouvrir PDF » (filtre « Documents PDF »), menu Fichier des éditeurs.
- **Restant à faire** : installation réelle (`sudo apt install`) et scénarios 2 à 11 sur
  Debian 13, Ubuntu 24.04 et AuxiNux OS avec un vrai bureau (GNOME, KDE ; X11 et Wayland),
  impression réelle, HiDPI, documents réels variés.
