# Confidentialité

AuxiNux Office est conçu pour fonctionner **entièrement en local et hors ligne**.

## 1. Engagements

| Engagement | Mise en œuvre |
|---|---|
| Aucune télémétrie AuxiNux | aucun code de mesure ou de statistiques n'est ajouté ; pas de service AuxiNux contacté |
| Aucun analytics | le composant d'analytique des éditeurs d'upstream est remplacé par une version inerte ; les statistiques Google Analytics du module Éditeur photo sont désactivées ; le build refuse d'emballer un fichier contenant une adresse de traçage connue (§3) |
| Aucun pixel espion | ouvrir un document ne télécharge jamais ses ressources distantes (image liée par URL, image ou feuille de style d'une page HTML) : convertisseur sans accès réseau, pages limitées aux ressources locales (§2) |
| Aucune publicité, aucun identifiant publicitaire | aucun module publicitaire ; aucun identifiant d'installation ou d'utilisateur n'est créé |
| Aucun compte obligatoire | toutes les fonctions locales sont utilisables sans compte ; la page d'inscription d'upstream est désactivée |
| Aucun envoi de documents ou de contenu local | les documents ne quittent la machine que si l'utilisateur le demande (cloud qu'il a lui-même connecté, envoi par courriel, module qu'il installe) |
| Aucun nom réel imposé | l'auteur écrit par défaut dans les documents, commentaires et modifications suivies est « Utilisateur » (« User »), pas le nom du compte du système ; chacun choisit son nom dans les paramètres de l'accueil |
| Fonctionnement hors ligne | ouverture, édition, conversion, export PDF, impression, correcteur orthographique, polices : tout est local ; testé automatiquement sans réseau |
| Cloud facultatif | aucun cloud n'est configuré ; le panneau « Clouds » ne se connecte qu'à un serveur saisi par l'utilisateur |

## 2. Communications héritées d'ONLYOFFICE : audit et décisions

| Fonction d'upstream | Destination | Quand | AuxiNux Office 0.1.0 |
|---|---|---|---|
| Galerie de modèles en ligne | templates.onlyoffice.com | à chaque affichage de l'accueil | **désactivée** (patch desktop-apps 0004 et module d'accueil) ; modèles locaux conservés ; réactivable explicitement avec `--templates-url=<url>` |
| Sondes DNS sur HTTPS et réseau d'arrière-plan du moteur web (Chromium) | dns.google, 8.8.8.8, 1.1.1.1, chrome.cloudflare-dns.com, 2001:4860:4860::8888… | en continu dès le démarrage (**1 527 tentatives** relevées lors de l'audit initial) | **désactivées** : commutateurs `--disable-features=DnsOverHttps --disable-background-networking --disable-domain-reliability --no-pings --disable-spell-checking` (`privacy.engine_switches` de `branding/product.json`), ajoutés par le lanceur ; le shell se relance lui-même avec ces commutateurs s'il est démarré sans eux (binaire lancé directement, raccourci épinglé, autre `--disable-features`) ; sous macOS, l'exécutable de l'application est un lanceur AuxiNux qui les ajoute ; **0 tentative** après correction |
| Téléchargement des ressources distantes d'un document par le convertisseur (x2t) : image liée par URL (DOCX, ODT, PPTX), image et feuille de style d'une page HTML | serveur choisi par l'auteur du document (pixel espion : adresse IP, heure d'ouverture) | **à l'ouverture du document**, sans clic (programmes `curl`/`wget` sous Linux et macOS, `URLDownloadToFile`/PowerShell sous Windows) | **bloqué** depuis l'audit du 2026-10-02 : x2t est remplacé par une garde AuxiNux (`src/x2tguard`) qui active l'option `allowNetworkRequest=false` du convertisseur puis exécute x2t (renommé `x2t-engine`) ; testé avec des documents piégés |
| Chargement direct d'une ressource distante par le moteur web (image d'un document ou d'un fragment HTML collé, requête d'une macro, préchargement DNS des liens) | serveur choisi par l'auteur du contenu | affichage | **bloqué** : `Content-Security-Policy` sur l'accueil, les éditeurs et les modules locaux (ressources `file:`, `ascdesktop:`, `data:`, `blob:` uniquement), préchargement DNS désactivé |
| Module Éditeur photo (bibliothèque TOAST UI) | google-analytics.com | ouverture du module (au plus une fois par semaine) | **désactivé** : l'option d'upstream était mal placée et sans effet ; statistiques désactivées et adresse de collecte retirée des bibliothèques |
| Assistant IA, fournisseur Together.ai | relais plugins-services.onlyoffice.com | si l'utilisateur active l'IA et choisit ce fournisseur | **fournisseur retiré** (le texte, le document et la clé d'API passaient par un serveur d'ONLYOFFICE) ; adresse du relais retirée |
| Aide en ligne des éditeurs | helpcenter.onlyoffice.com | bouton Aide | **retirée** (`help: false`) ; aide hors ligne prévue à la feuille de route |
| Vérification et téléchargement des mises à jour | serveurs ONLYOFFICE (service `updatesvc`) | périodiquement | **absent** (module de mise à jour non compilé, service retiré) ; voir [docs/UPDATES.md](docs/UPDATES.md) |
| Inscription / création de portail | onlyoffice.com | bouton de l'accueil | **désactivée** (aucune URL d'inscription) |
| Modules réseau : DeepL, LanguageTool, Zotero, Thésaurus (API words.bighugelabs.com), OCR (données de langue téléchargées) | services tiers | à l'utilisation | **retirés** de la distribution (`privacy.removed_plugins` de `branding/product.json`) |
| Assistant IA (module « AI ») | fournisseurs d'IA configurés par l'utilisateur | à l'utilisation | **désactivé par défaut** (`disable-ai=1`, écrit avant l'initialisation du moteur) ; l'utilisateur peut l'activer dans les paramètres et doit alors choisir et configurer lui-même un fournisseur. Le module « Agent IA » (panneau de l'accueil) est retiré |
| Gestionnaire de modules (catalogue) | onlyoffice.github.io | **à l'ouverture** du gestionnaire par l'utilisateur | conservé (action volontaire) |
| Clouds (DocSpace, Nextcloud, ownCloud, kDrive, Seafile…) | serveur saisi par l'utilisateur | après connexion par l'utilisateur | **masqué** en 0.1.0 (panneau « Clouds » de l'accueil) |
| Liens (site office.auxinux.ca, licences) | navigateur de l'utilisateur | au clic | conservés |
| Module « Envoyer » | client de messagerie du système | à l'utilisation | conservé (local) |
| Instance unique (Linux) | 127.<uid>.1:13012 (UDP, adresse de boucle locale propre à chaque compte) | au lancement | interface locale uniquement |
| Impression | CUPS / spouleur Windows | à l'impression | local (imprimantes configurées par le système) |

Le correcteur orthographique (dictionnaires Hunspell), les polices, les conversions (x2t) et
l'export PDF sont locaux. Le correcteur du moteur web (Chromium), qui téléchargerait ses
dictionnaires, est désactivé (`--disable-spell-checking`) : il ne sert pas aux éditeurs. Aucun rapport de plantage n'est envoyé (le moteur web n'est pas
configuré pour en transmettre : pas de fichier `crash_reporter.cfg`).

## 3. Vérification

L'étape `test` du build ([BUILD.md](BUILD.md#71-tests)) :

1. contrôle l'arbre livré (Linux, Windows, macOS) : aucun vidage mémoire ni adresse de
   traçage connue (Google Analytics, Google Tag Manager, DoubleClick ; exception : tables
   internes du moteur Chromium), `Content-Security-Policy` sur l'accueil et les éditeurs,
   garde réseau du convertisseur, commutateurs du moteur dans le lanceur et le shell. L'étape
   `package` refuse aussi d'emballer un arbre contenant un vidage mémoire ou un traqueur ;
2. exécute les tests graphiques dans un **espace de noms réseau isolé** (`unshare -n`, aucune
   interface réseau) : accueil, documents DOCX, XLSX, PPTX, PDF et AuxiText fonctionnent ;
3. relance une session **sous `strace`** (appels `connect`, `sendto`, `sendmsg`, `execve`) :
   accueil, un document de chaque type, puis des **documents piégés** (image liée par URL en
   DOCX, ODT et PPTX, page HTML avec image et feuille de style distantes ;
   `tests/fixtures/trap_documents.py`, adresses 203.0.113.0/24) ; toute tentative de
   connexion autre que locale (127.0.0.0/8, ::1) et tout lancement de `curl` ou `wget` font
   échouer les tests ;
4. convertit les documents piégés avec le convertisseur livré sous `strace` : aucun
   téléchargement.

Vérifier soi-même :

```sh
# Linux : toutes les tentatives de connexion pendant une session
strace -f -e trace=connect -o /tmp/auxioffice-net.log auxioffice
grep -E 'AF_INET6?' /tmp/auxioffice-net.log | grep -v -E '127\.0\.0\.|::1'

# Linux : sans aucun accès réseau (espace de noms réseau vide)
unshare -Un auxioffice        # ou : firejail --net=none auxioffice
```

(Ne pas utiliser `unshare -r` : AuxiNux Office refuse de s'exécuter en tant que root. Sous
Ubuntu 24.04, les espaces de noms non privilégiés peuvent être restreints par AppArmor ;
`firejail` ou la désactivation temporaire du réseau conviennent alors.)

Sous Windows : Moniteur de ressources (onglet Réseau), pare-feu Windows (règles sortantes) ou
Wireshark. Penser aux processus lancés par AuxiNux Office (`x2t-engine.exe`, `powershell.exe`) :
une règle de pare-feu limitée à l'application ne les couvre pas.

### macOS (version préliminaire)

L'application macOS réutilise le shell d'upstream (non recompilé). Depuis l'audit du
2026-10-02 : l'exécutable de l'application est un lanceur AuxiNux qui démarre le shell
(« AuxiNux Office Engine ») avec les commutateurs de confidentialité du moteur web ; x2t est
remplacé par la garde réseau ; l'adresse Google Analytics (code inactif d'upstream) est retirée
du shell ; l'exception NSAppTransportSecurity (HTTP non chiffré) est retirée ; pages des
éditeurs protégées par la même CSP. Sparkle est désactivé (sans adresse de flux) ; l'assistant
IA est désactivé au premier lancement ; le menu Aide ouvre office.auxinux.ca. Le lanceur et la
garde sont compilés depuis Linux et **n'ont pas encore été exécutés sur un Mac** : à vérifier
avec LuLu ou Little Snitch. Voir [docs/MACOS.md](docs/MACOS.md).

## 4. Données enregistrées localement

| Données | Linux | Windows |
|---|---|---|
| Réglages | `~/.config/auxinux-office/` | `%APPDATA%\AuxiNux\AuxiNuxOffice\` |
| Documents récents, polices analysées, fichiers de récupération, modules ajoutés, réglages du moteur | `~/.local/share/auxinux-office/` | `%LOCALAPPDATA%\AuxiNux\AuxiNuxOffice\data\` |
| Cache du moteur web | `~/.cache/auxinux-office/` | `%LOCALAPPDATA%\AuxiNux\AuxiNuxOffice\cache\` |

Ces données ne sont jamais transmises. Pour tout effacer : supprimer ces dossiers (la
désinstallation les conserve volontairement, pour ne pas perdre de réglages lors d'une
réinstallation). La liste des documents récents peut aussi être vidée depuis l'accueil.

Les copies de travail des documents ouverts (`cef/work_temp` dans le cache) sont supprimées à
la fermeture ; celles d'une session interrompue (plantage, fermeture de session) le sont au
démarrage suivant. Le fichier de réglages d'AuxiText (fichiers récents) n'est lisible que par
l'utilisateur.

Comme toute application de bureau, AuxiNux Office inscrit les documents ouverts dans les listes
de documents récents du système : `~/.local/share/recently-used.xbel` sous Linux (gestionnaires
de fichiers), listes de raccourcis et historique sous Windows. Ces listes restent sur la
machine ; « Vider la liste » de l'accueil ne les efface pas (utiliser les réglages du système).

Les documents enregistrés contiennent, comme avec toute suite bureautique, des métadonnées
(auteur — « Utilisateur » par défaut —, dates) et le nom de l'application qui les a produits
(« AuxiNux Office »).

## 5. Limites et points à l'étude

- L'audit couvre les scénarios testés (accueil, ouverture et édition des formats principaux).
  Les fonctions déclenchées par l'utilisateur (clouds, catalogue de modules, assistant IA s'il
  est activé, liens) utilisent le réseau par nature.
- Les tests réseau automatiques s'exécutent sous Linux, dans un espace de noms sans réseau :
  le moteur web s'y sait hors ligne et tente moins de choses qu'avec un vrai réseau. Un audit
  avec réseau (capture de paquets) reste à ajouter.
- Sous Windows et macOS, les mêmes protections s'appliquent (garde du convertisseur, CSP,
  commutateurs) mais restent à vérifier sur un vrai système
  ([docs/TESTING-WINDOWS.md](docs/TESTING-WINDOWS.md), [docs/MACOS.md](docs/MACOS.md)).
- Fonctions déclenchées par l'utilisateur qui téléchargent une ressource désignée par une
  adresse : insertion d'une image « depuis une URL », comparaison avec un document distant,
  macros autorisées par l'utilisateur (leurs requêtes vers des serveurs restent soumises à la
  CSP et à l'invite d'autorisation des macros).
- Windows : un lien d'image `file://\\serveur\partage` dans un document pourrait provoquer une
  connexion à un partage réseau (identifiants Windows) ; la CSP autorise le schéma `file:`
  (documents locaux) et ne l'empêche donc pas : à évaluer sur un vrai Windows.

Signaler un problème de confidentialité : voir [CONTRIBUTING.md](CONTRIBUTING.md).
