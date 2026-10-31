# AuxiOffice Online

La suite AuxiOffice dans le navigateur, pour **web.office.auxinux.ca** : AuxiMail (lien vers
le webmail, adresse réglée dans l'administration), AuxiWriter, AuxiSheet, AuxiPresent,
AuxiDraw, AuxiPDF, AuxiText et **AuxiCorrect** (correcteur et dictionnaire, en ligne
seulement), plus **AuxiSheet Lite** (bouton « Lite » des classeurs .xlsx).

Les applications sont **celles du bureau**, sans copie de leur code : la même interface
React (`app/ui`, `text/ui`) est construite une seconde fois pour le web, avec les modules de
Tauri remplacés par des équivalents web (`web/shims/`). Elles se comportent donc comme sur le
bureau : AuxiOffice est le lanceur, chaque application démarre sur un document, une
« fenêtre » par document (un onglet du navigateur) ou des onglets dans l'application (réglage
du menu Fichier), mêmes menus, ruban, boîtes de dialogue, AuxiCorrect.

## Qui fait le travail : le navigateur d'abord

| Application | Où elle calcule | Rôle du serveur |
|---|---|---|
| **AuxiText** | Navigateur : CodeMirror + encodages en **Rust → WebAssembly** (`textio-wasm`, le même `textio.rs` que sur le bureau) | Garder les octets du fichier |
| **AuxiPDF** | Navigateur : PDF.js (lecture, formulaires, annotations) | Garder le fichier |
| **AuxiCorrect** | Interface dans le navigateur ; correction par `auxicorrect-cli` sur le serveur | Vérifier le texte, dictionnaire |
| **AuxiSheet Lite** | Navigateur : **IronCalc** (tableur en Rust → WebAssembly), lecture et écriture .xlsx comprises (`sheet-wasm`) | Garder le fichier |
| AuxiWriter, AuxiSheet, AuxiPresent, AuxiDraw | Interface, menus et boîtes dans le navigateur ; mise en page fidèle par le moteur de documents, **un processus isolé par document ouvert** | Moteur `auxi-engine`, tuiles compressées (≈ 5 Ko par tuile de 256 px) |

Le moteur ne tourne que pendant qu'un document de bureautique est ouvert. Il est fermé à la
fermeture de l'onglet, après une inactivité (`--idle-minutes`), et les moteurs sont
plafonnés (`--max-engines`, `--max-docs`).

## Architecture

```
navigateur ─┬─ /            portail (connexion, Créer, Applications, Mes fichiers)
            ├─ /office/     app/ui + shims  ──WebSocket /ws──┐
            ├─ /text/       text/ui + shims + textio.wasm    │
            ├─ /sheet/      AuxiSheet Lite (IronCalc .wasm)  │
            └─ /api/…       fichiers, réglages, session      │
                                                             ▼
auxi-online (Rust, axum) ── un auxi-engine par document, dans bubblewrap
  données/
    users.json            comptes (Argon2id)
    files/<compte>/…      « Mes fichiers » de chaque compte
    engines/slot-N/       profil et espace de travail d'un moteur
```

- `server/` : serveur `auxi-online` (Rust). Pas de Node.js en production : un seul
  exécutable sert l'interface, l'API et les moteurs, et réutilise le crate `auxi-engine` du
  bureau.
- `web/` : portail, AuxiSheet Lite, et la construction web des applications du bureau
  (`vite.config.ts`, modes `portal`, `office`, `text`, `sheet`).
- `web/shims/` : remplaçants de `@tauri-apps/*` : commandes de la coque → API et WebSocket,
  boîtes de dialogue et sélecteur de « Mes fichiers » en HTML, barre de menus HTML avec les
  raccourcis, glisser-déposer de fichiers (envoyés dans Documents), impression par le
  navigateur.
- `textio-wasm/`, `sheet-wasm/` : modules WebAssembly (Rust).

### AuxiCorrect

Si AuxiCorrect est installé sur le serveur (détecté comme sur le bureau par
`~/.config/auxinux/auxicorrect.json`, ou `--auxicorrect-cli <outil>`), le français est corrigé
comme dans AuxiWriter : soulignements et suggestions, options par compte (appliquées
aussitôt), dictionnaire (définitions, synonymes, conjugaison) et correction dans AuxiText.
`auxicorrect-cli` tourne sur le serveur ; le moteur, sans réseau, le joint par une prise Unix
de son emplacement (`slot-N/grammar.sock`), relayée en HTTP local dans le bac à sable.

### Coupures de connexion

Une coupure (Wi-Fi, mise en veille, mandataire redémarré) ne perd rien : les documents de
l'onglet restent ouverts sur le serveur (`--resume-seconds`, 180 s par défaut), le navigateur
se reconnecte seul à la même session et tout est redessiné.

### Sécurité

- Un document est **copié dans l'espace de travail de son moteur** à l'ouverture et recopié
  dans « Mes fichiers » à l'enregistrement : le moteur ne voit aucun autre fichier.
- Sous Linux, chaque moteur tourne dans **bubblewrap** : système en lecture seule, pas de
  réseau, espaces de noms séparés, seul son emplacement est modifiable (`--sandbox`).
- Le serveur filtre les requêtes de l'interface vers le moteur : seules les commandes
  d'édition passent ; macros, ouverture d'autres fichiers, liens et boîtes de fichiers du
  moteur sont refusés ; une image insérée (`file:///…`) est d'abord copiée depuis
  « Mes fichiers ».
- Chemins virtuels vérifiés (pas de `..`, pas de lien symbolique suivi), quota par compte.
- Session : témoin `HttpOnly; SameSite=Strict` (`Secure` avec `--secure-cookies`), en-tête
  `X-Auxi` exigé pour toute modification, origine vérifiée pour le WebSocket, essais de mot
  de passe ralentis.

## Construire

Prérequis : Rust avec la cible `wasm32-unknown-unknown`, `wasm-bindgen-cli` à la version
de `textio-wasm/Cargo.toml` (`cargo install wasm-bindgen-cli --version 0.2.129`), Node.js
20+, et le moteur de documents (`scripts/fetch-engine.sh`, comme pour le bureau).

```sh
online/build.sh            # modules wasm, interface web, serveur et moteur (--release)
online/build.sh --debug    # idem en mode débogage
online/build.sh --web-only # interface seulement
```

## Essayer sur son poste

```sh
target/release/auxi-online --no-auth     # un seul utilisateur « local », sans mot de passe
# puis http://127.0.0.1:8090/
```

Les emplacements sont trouvés seuls dans l'arbre de développement (`target/…/auxi-engine`,
`.engine/<plateforme>/program-dir`, `app/src-tauri/templates`, `online/web/dist`).

Développement de l'interface avec rechargement à chaud : lancer le serveur, puis
`cd online/web && npm run dev` et ouvrir http://localhost:5180/office/ (le serveur de Vite
relaie `/api` et `/ws` vers `AUXI_ONLINE_URL`, par défaut http://127.0.0.1:8090).

## Comptes

```sh
auxi-online user add ana@exemple.ca --name "Ana Tremblay" --data /var/lib/auxioffice-online
auxi-online user passwd ana@exemple.ca --data …
auxi-online user remove ana@exemple.ca --data …     # ses fichiers restent sur le disque
auxi-online user list --data …
```

Le mot de passe est lu dans `AUXI_PASSWORD`, sinon sur l'entrée standard. **Le premier compte
créé est administrateur** (`--admin` pour les suivants, ou `auxi-online user admin <courriel>`).

Dans le portail, le menu du compte (nom en haut à droite) mène à **Mon profil** (nom, mot de
passe, espace utilisé, options d'AuxiCorrect) et, pour les administrateurs, à
**Administration** : onglet **Réglages** (espace par défaut d'un compte, 1 Go au départ ;
documents ouverts par compte ; fermeture des documents inactifs ; adresse d'AuxiMail),
onglet **Serveur** (état : moteurs, documents, espace, bac à sable, AuxiCorrect) et onglet
**Comptes** : créer un compte, changer son nom, son mot de passe, son espace ou son rôle,
le supprimer (en gardant ou non ses fichiers). Un nouveau mot de passe ferme les sessions du
compte. Les sessions sont gardées dans `sessions.json` (empreinte SHA-256 des jetons
seulement) : un redémarrage du serveur ne déconnecte personne. Prévu ensuite : connexion
unique (OIDC) commune avec AuxiMail.

## Mettre en ligne (web.office.auxinux.ca)

1. Paquets du serveur (Debian 13) : `bubblewrap`, polices `fonts-crosextra-carlito`,
   `fonts-crosextra-caladea`, `fonts-liberation`, `fonts-dejavu`.
2. Facultatif : AuxiCorrect sur le serveur (`--auxicorrect-cli /chemin/auxicorrect-cli`).
3. Dossier d'installation, par exemple `/opt/auxioffice-online/` :
   `auxi-online`, `auxi-engine`, `templates/` (copie de `app/src-tauri/templates`),
   `web/` (copie de `online/web/dist`), et `engine/program/` (le moteur de documents :
   copie du dossier d'installation obtenu par `scripts/fetch-engine.sh`, ou
   `--lo-program <dossier program>`).
4. Utilisateur système et données : `useradd -r -d /var/lib/auxioffice-online auxioffice`.
5. Service : `deploy/auxioffice-online.service` (copie dans `/etc/systemd/system/`), puis
   `systemctl enable --now auxioffice-online`.
6. Mandataire HTTPS : `deploy/nginx.conf` (WebSocket compris), certificat Let's Encrypt.
   Le serveur écoute sur 127.0.0.1 : ne jamais l'exposer directement.
7. Premier compte (administrateur) : `sudo -u auxioffice /opt/auxioffice-online/auxi-online user add … --data /var/lib/auxioffice-online`.

### AuxiMail (AuxiMailWeb, connexion unique)

AuxiMailWeb (le webmail d'AuxiMail, dépôt `auxinux/AuxiMail`, serveur `auximail-web`) est servi
**sur le même hôte**, sous `/mail/`. Il n'a pas de comptes dans ce mode : à chaque requête, il
lit le témoin `auxi_session` du portail et le fait vérifier par `GET /api/me` d'auxi-online. Un
utilisateur connecté au portail ouvre donc son courriel sans deuxième connexion ; son espace
courriel est créé à sa première visite. Contrat complet : `web/INTEGRATION.md` du dépôt AuxiMail.

1. Installer le paquet Debian `auximail-web` sur le même serveur
   (`sudo apt install ./auximail-web_<version>_<arch>.deb`, ou `sudo auxi install --deb …`).
2. `/etc/default/auximail-web` (exemple : `deploy/auximail-web.default`) :
   `AUXIMAIL_WEB_OPTS="--base-path /mail --auxioffice-url http://127.0.0.1:8090"`, puis
   `sudo systemctl restart auximail-web` (il écoute sur 127.0.0.1:8095).
3. Relais de `/mail/`, au choix :
   - **nginx** : les deux blocs `location` de `deploy/nginx.conf` (repris de
     `web/deploy/nginx-auxioffice.conf` du dépôt AuxiMail), **avant** `location /` ; ajouter
     `--auximail-health http://127.0.0.1:8095` à auxi-online pour l'état dans l'administration ;
   - **ou le relais intégré** : `--auximail-proxy http://127.0.0.1:8095` (flux d'événements
     sans tampon ni délai, corps jusqu'à 60 Mo) ; nginx envoie alors tout à auxi-online.
4. Administration → Réglages → **Adresse d'AuxiMail** : `/mail/` (ou
   `https://web.office.auxinux.ca/mail/`), ou l'option `--auximail-url /mail/`.
5. Vérifier : Administration → Serveur → ligne « AuxiMail » (version, espaces ouverts).

La déconnexion se fait dans le portail ; le bouton « AuxiOffice Online » d'AuxiMail ramène au
portail. Le témoin est `SameSite=Strict` : arrivé sur `/mail/` par un lien d'un autre site
(un courriel, par exemple), le navigateur ne l'envoie pas au premier chargement ; passer par
le portail (tuile AuxiMail) ou recharger la page.

### Capacité

Chaque document de bureautique ouvert occupe un moteur (≈ 150 à 300 Mo de mémoire selon le
document). Réglez `--max-engines` d'après la mémoire du serveur (16 Go ≈ 30 à 40 moteurs) ;
AuxiText, AuxiPDF et AuxiSheet Lite ne consomment rien côté serveur.

## Limites actuelles

- Pas encore de coédition (deux personnes sur le même document) : un document n'est ouvert
  que par un onglet à la fois. LibreOfficeKit permet plusieurs vues par document, c'est la
  prochaine étape.
- Les réglages avancés d'AuxiCorrect (dictionnaire personnel, mots ignorés) restent dans
  l'application AuxiCorrect d'un ordinateur.
- Le copier-coller passe par le presse-papiers du navigateur : il exige HTTPS (ou
  `localhost`), ce qui est le cas derrière nginx.
- Le navigateur réserve certains raccourcis (Ctrl+N, Ctrl+T, Ctrl+W) ; le collage depuis le
  menu Édition est impossible (Ctrl+V fonctionne).
- AuxiSheet Lite ne conserve pas les graphiques, images, tableaux croisés ni macros d'un
  classeur : il le signale avant d'écraser un fichier existant.
