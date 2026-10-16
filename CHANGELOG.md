# Journal des modifications

## Non publié

- Moteur LibreOffice 26.8.1 (le rendu par tuiles sous macOS n'existe qu'à partir de 26.8) ;
  liaison `lok-sys` réalignée sur les tables de fonctions de 26.8 et contrôle de leur taille
  au démarrage.
- macOS : LibreOffice tourne sur le fil principal du moteur (mode « unipoll », requêtes
  confiées par Grand Central Dispatch), moteur retiré du Dock.
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
