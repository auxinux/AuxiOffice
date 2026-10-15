# Licences d'AuxiOffice

Ce document décrit le modèle de licence d'AuxiOffice et les obligations liées aux composants
tiers. **Il ne constitue pas un avis juridique** : il doit être validé par un juriste avant la
première distribution commerciale.

## 1. En résumé

- AuxiOffice est un **logiciel propriétaire** du Projet AuxiNux : tous droits réservés
  ([LICENSE](LICENSE)). Le code de l'interface (`app/`), de la coque et du moteur
  (`crates/auxi-engine`) n'a pas à être publié.
- Le moteur de documents est **LibreOffice**, sous **Mozilla Public License 2.0**, livré sous
  forme de binaires officiels **non modifiés** et exécuté dans un **processus séparé**.
- La seule partie d'AuxiOffice sous licence libre est `crates/lok-sys`, transcription en Rust
  des en-têtes de LibreOfficeKit : elle reste sous **MPL 2.0** et son code source est publié.
- AuxiOffice ne contient **aucun code d'ONLYOFFICE** ni d'AuxiNux Office (AGPL).

## 2. Pourquoi ce modèle est compatible avec un produit propriétaire

La MPL 2.0 est un copyleft **par fichier** : seules les modifications des fichiers sous MPL
doivent être publiées. Elle autorise explicitement à combiner ces fichiers avec du code sous
une autre licence, y compris propriétaire, au sein d'une « œuvre plus grande » (section 3.3).

AuxiOffice :

1. ne modifie aucun fichier de LibreOffice ;
2. publie le code de `lok-sys` (seul fichier dérivé de LibreOffice) ;
3. communique avec LibreOffice par son interface publique, depuis un processus distinct.

## 3. Obligations à chaque distribution

| Obligation | Comment AuxiOffice la respecte |
|---|---|
| Informer les destinataires de la disponibilité du code source de LibreOffice (MPL 3.2 a) | lien vers l'archive source exacte, épinglée dans `engine/libreoffice.lock.json` (`source.url`, `sha256`) ; à afficher dans « À propos » et dans la documentation des paquets |
| Fournir le texte de la MPL et les mentions de LibreOffice | fichiers `LICENSE`, `LICENSE.html`, `NOTICE` et `CREDITS.fodt` de LibreOffice, conservés dans `engine/` tels qu'ils sont livrés |
| Publier le code source de `lok-sys` et de ses modifications | publication du dossier `crates/lok-sys` avec chaque version (dépôt public dédié ou archive sur office.auxinux.ca) — **à mettre en place avant la première diffusion** |
| Composants tiers inclus dans LibreOffice (bibliothèques, dictionnaires, polices) | ils sont couverts par les licences listées dans `LICENSE.html` de LibreOffice ; ils sont redistribués sans modification, avec ces mentions |
| Dépendances Rust et npm de la coque et de l'interface | licences permissives (MIT, Apache 2.0, BSD, ISC, Zlib, Unicode) ; une liste des licences tierces doit être générée et livrée avec l'application — **à faire** (par exemple `cargo about` et `license-checker`) |

## 4. Marques

- « LibreOffice » est une marque déposée de The Document Foundation. AuxiOffice ne l'emploie
  que pour indiquer l'origine du moteur (« Moteur de documents : LibreOffice »), jamais comme
  nom de produit, et n'affiche pas le logo LibreOffice.
- Les noms et logos AuxiNux et AuxiOffice (`branding/`) appartiennent au Projet AuxiNux.

## 5. Ce qu'il faut éviter dans le cœur du produit

- Code sous **GPL ou AGPL** (il imposerait la publication de l'ensemble) : par exemple
  HyperFormula (GPL v3 sans licence commerciale), ou le code d'ONLYOFFICE.
- Bibliothèques « freemium » dont les fonctions utiles sont réservées à une édition payante.
- Toute modification de fichiers de LibreOffice sans la publier.

## 6. AuxiNux Office (produit précédent)

AuxiNux Office 0.1.0 était un fork AGPL d'ONLYOFFICE. Ses versions déjà distribuées restent
sous AGPL : leur code source correspondant doit rester accessible aux personnes qui ont reçu
ces binaires (étiquette git `auxinux-office-0.1.0-final` et sources d'ONLYOFFICE aux commits
indiqués dans cette version).
