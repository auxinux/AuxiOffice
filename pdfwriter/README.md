# AuxiPDFWriter

Version « Pro » d'AuxiPDF : lire, créer et modifier des PDF. Application autonome, **pas encore
intégrée à la suite** : aucune entrée dans le lanceur d'AuxiOffice, ni dans AuxiOffice Online, ni
dans les paquets de la suite (`scripts/build-*.sh`). Elle ne dépend d'aucun crate d'AuxiOffice ni de
LibreOffice.

## Fonctions

- **Lire** : pages, zoom, recherche, signets, liens, formulaires, PDF protégés par mot de passe.
- **Créer** : document vierge (Lettre, Légal, Tabloïd, A3, A4, A5), ou à partir d'images
  (PNG, JPEG, WebP, BMP, GIF).
- **Modifier le texte du document** : un clic sur le texte, puis le nouveau texte. L'ancien texte
  quitte vraiment le fichier. La police d'origine est gardée quand elle contient les caractères
  demandés ; sinon la police standard la plus proche la remplace (l'application le signale).
- **Ajouter** : zones de texte, images, rectangles, ellipses, lignes, surlignages, masques blancs.
  Ils restent déplaçables et modifiables pendant toute la session, même après l'enregistrement.
- **Pages** : insérer (vierges ou depuis un PDF), dupliquer, supprimer, réordonner par glisser,
  tourner, recadrer, extraire ; sélection multiple (Ctrl, Maj). Une page ou un texte supprimé ne reste
  pas dans le fichier.
- **Fusionner** plusieurs PDF (ordre, choix des pages, un signet par fichier) ; **découper** (toutes
  les n pages, ou par groupes `1-3 / 4-6, 9`).
- **Numéroter** les pages, **filigrane**, **propriétés** du document.
- **Mot de passe** : chiffrement AES-256 à l'enregistrement. Un PDF protégé ouvert ici le reste. Si
  son auteur a interdit la modification, il s'ouvre en lecture seule.
- Annuler et rétablir, impression (CUPS, ou aperçu du système), glisser-déposer de fichiers
  (sur le panneau des pages : insertion ; ailleurs : ouverture ; image : ajout à la page).

## Limites connues

- Texte ajouté ou écrit en police standard : alphabet latin (Windows-1252, français complet).
- « Modifier le texte » travaille ligne par ligne, sans refaire la mise en page du paragraphe, et
  seulement sur le texte placé directement dans la page : pas dans les objets réutilisables (XObject),
  ni dans une image numérisée (pas de reconnaissance de caractères).
- Le masque blanc cache l'affichage, sans effacer le contenu. Il n'y a pas encore de caviardage.
- Le recadrage masque le contenu hors cadre sans l'effacer.
- La fusion ne reprend pas les signets ni les champs de formulaire des fichiers d'origine. Pas de
  création de champs ni de signature numérique.

## Architecture

- `src-tauri/` : coque Rust (Tauri 2), crate et binaire `auxipdfwriter`, identifiant
  `ca.auxinux.pdfwriter` : fichiers (écriture atomique), chiffrement (`lopdf`), impression, instance
  unique, préférences. Une fenêtre par document ; un fichier reçu remplace un document vierge intact.
- `ui/src/core/` : le cœur, sans DOM, exécuté dans un fil de travail (`worker.ts`). Chaque opération
  prend des octets et rend des octets ; ainsi Annuler ne fait que reprendre l'état précédent.
  - `pages.ts` : structure du document (pdf-lib), et `collectGarbage` à chaque enregistrement, sans
    quoi pdf-lib laisserait les objets retirés dans le fichier.
  - `textedit.ts` : interprète le flux de contenu de la page (matrices, état du texte, polices,
    ToUnicode, largeurs) et réécrit directement les instructions du texte modifié ; le reste du
    flux est conservé à l'octet près.
  - `objects.ts` : objets ajoutés et leur écriture dans le PDF.
- `ui/src/Viewer.tsx` : PDF.js, avec un calque voisin pour les objets et les outils.
- `ui/src/model.ts` : état du document et historique.

Composants : PDF.js (Apache 2.0), pdf-lib et @pdf-lib/standard-fonts (MIT), lopdf (MIT).

## Construire

Le crate est autonome (hors du workspace de la suite, son propre `Cargo.lock`).

macOS (Apple Silicon ou Intel), produit `pdfwriter/target/macos/AuxiPDFWriter.app` :

```sh
pdfwriter/build-mac.sh
```

À la main (Linux, ou pour lancer les tests) :

```sh
cd pdfwriter
npm install
npm test
npm run build
cd src-tauri
cargo test
cargo build --release --features custom-protocol
target/release/auxipdfwriter [fichier.pdf]
```

Développement : `npx vite` dans `pdfwriter/`, puis `cargo run` dans `pdfwriter/src-tauri/`.
