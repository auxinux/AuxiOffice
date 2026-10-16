# Architecture d'AuxiOffice

```
┌──────────────────────── AuxiOffice (propriétaire) ─────────────────────────┐
│ app/ui          Interface React + TypeScript (onglets, accueil, barres     │
│                 d'outils, rendu par tuiles, saisie clavier et souris)      │
│ app/src-tauri   Coque Tauri 2 (Rust) : fenêtre, dialogues, un moteur par   │
│                 document, relais des événements                            │
│ crates/auxi-engine                                                         │
│   client.rs     lance et pilote le processus moteur                        │
│   protocol.rs   trames JSON + binaire sur stdin/stdout                     │
│   bin/auxi-engine.rs + lok.rs   processus moteur                           │
└───────────────┬────────────────────────────────────────────────────────────┘
                │ processus séparé, une instance par document
┌───────────────▼──────────────┐
│ crates/lok-sys (MPL 2.0)     │  transcription des en-têtes C de LibreOfficeKit
├──────────────────────────────┤
│ LibreOffice 26.8.1 (MPL 2.0) │  binaires officiels non modifiés (engine/)
└──────────────────────────────┘
```

## Choix structurants

- **Moteur LibreOffice via LibreOfficeKit.** Il apporte la mise en page, le calcul, le rendu
  et les filtres d'import/export (OOXML, ODF, formats binaires Office, PDF). AuxiOffice ne
  maintient aucun moteur de mise en page.
- **Binaires officiels, non modifiés.** Pas de compilation de LibreOffice : la version est
  épinglée avec ses sommes SHA-256 dans `engine/libreoffice.lock.json` et téléchargée par
  `scripts/fetch-engine.sh`.
- **Un processus moteur par document** (`auxi-engine`). Il isole les plantages (seul l'onglet
  est perdu), sépare les fils d'exécution de LibreOffice de ceux de la fenêtre, et marque une
  frontière nette entre le code propriétaire et le code sous MPL.
- **Interface entièrement maison.** LibreOffice ne dessine que le contenu du document, par
  tuiles de 256 × 256 pixels ; barres d'outils, onglets, curseur, sélection, en-têtes du
  tableur et miniatures sont dessinés par AuxiOffice.

## Protocole moteur

Trames `[u32 longueur JSON][u32 longueur binaire][JSON][octets]` (`protocol.rs`).

| Commande | Rôle |
|---|---|
| `hello` | versions du moteur et de LibreOffice |
| `load` | ouvre un fichier ; signale verrou (`locked_by`) et lecture seule ; `ignore_lock` |
| `info` | type, parties (feuilles, diapositives), taille en twips, pages |
| `paint` | rend une zone (twips) en RGBA ; `part` pour une partie précise |
| `key`, `text`, `mouse` | clavier (codes VCL), texte saisi ou composé (IME), souris |
| `uno` | commande `.uno:` (seules celles-ci sont acceptées) |
| `set_part`, `client_zoom`, `visible_area` | navigation et zoom (tableur) |
| `selection`, `paste` | presse-papiers |
| `command_values` | listes : polices, styles, en-têtes du tableur |
| `save_in_place` | Fichier > Enregistrer (`.uno:Save`, attend la confirmation) |
| `save_as_location` | Enregistrer sous (le document prend le nouvel emplacement) |
| `save` | export d'une copie (PDF notamment) |
| `paint_window`, `window_mouse`, `window_key`, `window_text`, `window_close` | boîtes de dialogue et listes déroulantes de LibreOffice (rappels `window`) |

Les rappels de LibreOffice (`invalidate_tiles`, `invalidate_visible_cursor`,
`text_selection`, `state_changed`, `cell_cursor`…) sont relayés à l'interface comme
événements `engine`.

## Boîtes de dialogue, menus

- Les boîtes de dialogue de LibreOffice (déclenchées par une commande `.uno:…Dialog`, un menu
  ou le ruban) sont annoncées par le rappel `window` (`created`, `invalidate`, `close`…).
  L'interface les dessine (`paint_window`, avec l'échelle de l'écran : position et taille en
  pixels physiques pour `paintWindowDPI`) et leur transmet souris et clavier ; les fenêtres
  `child` (listes déroulantes) se placent sur leur parente (`position`).
- Le menu contextuel est décrit en JSON par le rappel `context_menu` (libellés traduits,
  sous-menus, commandes) ; les entrées inactives sont masquées.
- `app/ui/src/actions.ts` est le catalogue unique des commandes (barre de menus native via
  l'API menu de Tauri, ruban) ; les raccourcis natifs sont réservés aux actions de
  l'application, ceux de LibreOffice lui arrivent par le clavier.
- Un moteur de réserve est démarré après l'affichage de l'interface (commande
  `warm_engine`) ; l'ouverture d'un document n'attend plus le démarrage de LibreOffice.

## Particularités de LibreOfficeKit à connaître

- Ne pas activer `LOK_FEATURE_NO_TILED_ANNOTATIONS` : avec LibreOffice 26.2 et 26.8, il vide
  entièrement le rendu des présentations.
- La saisie de texte passe par `postWindowExtTextInputEvent` (comme Collabora Online) ; les
  touches de caractères envoyées par `postKeyEvent` ne sont pas fiables.
- Un verrou `.~lock.<nom>#` existant fait ouvrir le document **en lecture seule sans le
  signaler** : le moteur le détecte lui-même. Les verrous laissés par notre propre profil sont
  retirés automatiquement.
- `.uno:SaveAs` est converti en simple export par LibreOfficeKit ; « Enregistrer sous » utilise
  `saveAs` avec l'option `TakeOwnership`.
- Les événements clavier sont traités de façon asynchrone par LibreOffice.
- LibreOffice peut écrire sur stdout : le moteur réserve le descripteur d'origine au
  protocole et redirige stdout vers stderr.
- `LOK_ALLOWLIST_LANGUAGES` doit lister les langues pour activer correcteur et césure.
- La partie « instable » de l'API (`LOK_USE_UNSTABLE_API`) **change de disposition d'une
  version à l'autre** : LibreOffice 26.8 a retiré `sendDialogEvent` et `setAllowChangeComments`
  au milieu des tables de fonctions. `lok-sys` transcrit exactement la version épinglée et le
  moteur refuse de démarrer si la taille des tables annoncée par LibreOffice diffère
  (`check_layout`). Changer de version de LibreOffice impose donc de vérifier `lok-sys`.
- Le rendu par tuiles n'existe sous macOS qu'à partir de LibreOffice 26.8 (`doc_paintTile`
  l'excluait auparavant).

## macOS : moteur compilé avec le module « svp »

Le LibreOffice officiel pour Mac **ne peut pas** servir de moteur : il n'inclut que le module
d'affichage AppKit, et seul le module sans écran « svp » sait dessiner les pages dans un tampon
mémoire (`SalVirtualDevice::SetSizeUsingBuffer` : « Only the headless/svp virtual device has an
implementation »). Essais écartés, pour mémoire :

- mode threadé : AppKit refuse de tourner hors du fil principal (exception au démarrage) ;
- mode « unipoll » : `runLoop` ressort aussitôt (`ImplSVMain` s'arrête si VCL est déjà
  initialisé), `Desktop::Main` ne tourne jamais et `loadComponentFromURL` plante
  (`SfxApplication::GetFilterMatcher`) — reproduit sous Linux ;
- dans tous les cas, le rendu resterait vide faute de `SetSizeUsingBuffer`.

Sous macOS, `scripts/build-engine-macos.sh` compile donc LibreOffice (sources officielles
épinglées, **non modifiées**) avec `--enable-headless` ; le moteur fonctionne alors exactement
comme sous Linux (fil LibreOffice séparé, module svp). Le moteur ne reçoit aucun argument
(configuration par variables `AUXI_ENGINE_*`) : sous macOS, LibreOffice lit les arguments du
processus hôte.
