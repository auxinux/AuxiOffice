# Confidentialité

AuxiNux Office est conçu pour fonctionner **entièrement en local et hors ligne**.

## 1. Engagements

| Engagement | Mise en œuvre |
|---|---|
| Aucune télémétrie AuxiNux | aucun code de mesure ou de statistiques n'est ajouté ; pas de service AuxiNux contacté |
| Aucun analytics | le code d'analytique des éditeurs web d'upstream (prévu pour les serveurs ONLYOFFICE) n'est pas configuré dans l'application de bureau ; vérifié par l'audit (§3) |
| Aucune publicité, aucun identifiant publicitaire | aucun module publicitaire ; aucun identifiant d'installation ou d'utilisateur n'est créé |
| Aucun compte obligatoire | toutes les fonctions locales sont utilisables sans compte ; la page d'inscription d'upstream est désactivée |
| Aucun envoi de documents ou de contenu local | les documents ne quittent la machine que si l'utilisateur le demande (cloud qu'il a lui-même connecté, envoi par courriel, module qu'il installe) |
| Fonctionnement hors ligne | ouverture, édition, conversion, export PDF, impression, correcteur orthographique, polices : tout est local ; testé automatiquement sans réseau |
| Cloud facultatif | aucun cloud n'est configuré ; le panneau « Clouds » ne se connecte qu'à un serveur saisi par l'utilisateur |

## 2. Communications héritées d'ONLYOFFICE : audit et décisions

| Fonction d'upstream | Destination | Quand | AuxiNux Office 0.1.0 |
|---|---|---|---|
| Galerie de modèles en ligne | templates.onlyoffice.com | à chaque affichage de l'accueil | **désactivée** (patch desktop-apps 0004 et module d'accueil) ; modèles locaux conservés ; réactivable explicitement avec `--templates-url=<url>` |
| Sondes DNS sur HTTPS et réseau d'arrière-plan du moteur web (Chromium) | dns.google, 8.8.8.8, 1.1.1.1, chrome.cloudflare-dns.com, 2001:4860:4860::8888… | en continu dès le démarrage (**1 527 tentatives** relevées lors de l'audit initial) | **désactivées** : le lanceur passe `--disable-features=DnsOverHttps --disable-background-networking --disable-domain-reliability --no-pings` ; **0 tentative** après correction |
| Aide en ligne des éditeurs | helpcenter.onlyoffice.com | bouton Aide | **retirée** (`help: false`) ; aide hors ligne prévue à la feuille de route |
| Vérification et téléchargement des mises à jour | serveurs ONLYOFFICE (service `updatesvc`) | périodiquement | **absent** (module de mise à jour non compilé, service retiré) ; voir [docs/UPDATES.md](docs/UPDATES.md) |
| Inscription / création de portail | onlyoffice.com | bouton de l'accueil | **désactivée** (aucune URL d'inscription) |
| Modules réseau : DeepL, LanguageTool, Zotero, Thésaurus (API words.bighugelabs.com), OCR (données de langue téléchargées) | services tiers | à l'utilisation | **retirés** de la distribution (`privacy.removed_plugins` de `branding/product.json`) |
| Assistant IA (modules « AI » et « Agent IA ») | fournisseurs d'IA configurés par l'utilisateur | à l'utilisation | **désactivé par défaut** (`disable-ai=1`, écrit avant l'initialisation du moteur) ; l'utilisateur peut l'activer dans les paramètres et doit alors choisir et configurer lui-même un fournisseur |
| Gestionnaire de modules (catalogue) | onlyoffice.github.io | **à l'ouverture** du gestionnaire par l'utilisateur | conservé (action volontaire) |
| Clouds (DocSpace, Nextcloud, ownCloud, kDrive, Seafile…) | serveur saisi par l'utilisateur | après connexion par l'utilisateur | conservé (facultatif) |
| Liens (site AuxiNux, licences) | navigateur de l'utilisateur | au clic | conservés |
| Module « Envoyer » | client de messagerie du système | à l'utilisation | conservé (local) |
| Instance unique (Linux) | 127.0.0.1:13012 (UDP) | au lancement | interface locale uniquement |
| Impression | CUPS / spouleur Windows | à l'impression | local (imprimantes configurées par le système) |

Le correcteur orthographique (dictionnaires Hunspell), les polices, les conversions (x2t) et
l'export PDF sont locaux. Aucun rapport de plantage n'est envoyé (le moteur web n'est pas
configuré pour en transmettre : pas de fichier `crash_reporter.cfg`).

## 3. Vérification

L'étape `test` du build Linux ([BUILD.md](BUILD.md#71-tests)) :

1. exécute les tests graphiques dans un **espace de noms réseau isolé** (`unshare -n`, aucune
   interface réseau) : accueil, documents DOCX, XLSX, PPTX, PDF et AuxiText fonctionnent ;
2. relance une session **sous `strace`** (appels `connect`, `sendto`, `sendmsg`) : accueil puis
   un document de chaque type ; toute tentative de connexion autre que locale (127.0.0.0/8,
   ::1) fait échouer les tests. Résultat de la version 0.1.0 : **0 tentative**.

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
Wireshark.

### macOS (version préliminaire)

L'application macOS réutilise le shell d'upstream sans lanceur AuxiNux : les options réseau
du moteur web (DNS sur HTTPS, réseau d'arrière-plan) n'y sont **pas** appliquées et n'ont pas
encore été auditées ; Sparkle est désactivé ; l'assistant IA est désactivé au premier
lancement ; le menu Aide ouvre l'aide en ligne d'ONLYOFFICE. Voir [docs/MACOS.md](docs/MACOS.md).

## 4. Données enregistrées localement

| Données | Linux | Windows |
|---|---|---|
| Réglages | `~/.config/auxioffice/` | `%APPDATA%\AuxiNux\AuxiOffice\` |
| Documents récents, polices analysées, fichiers de récupération, modules ajoutés, réglages du moteur | `~/.local/share/auxioffice/` | `%LOCALAPPDATA%\AuxiNux\AuxiOffice\data\` |
| Cache du moteur web | `~/.cache/auxioffice/` | `%LOCALAPPDATA%\AuxiNux\AuxiOffice\cache\` |

Ces données ne sont jamais transmises. Pour tout effacer : supprimer ces dossiers (la
désinstallation les conserve volontairement, pour ne pas perdre de réglages lors d'une
réinstallation). La liste des documents récents peut aussi être vidée depuis l'accueil.

Les documents enregistrés contiennent, comme avec toute suite bureautique, des métadonnées
(auteur, dates) et le nom de l'application qui les a produits (« AuxiNux Office »).

## 5. Limites et points à l'étude

- L'audit couvre les scénarios testés (accueil, ouverture et édition des formats principaux).
  Les fonctions déclenchées par l'utilisateur (clouds, catalogue de modules, assistant IA s'il
  est activé, liens) utilisent le réseau par nature.
- Documents contenant des ressources distantes (images liées par URL, données externes) :
  comportement du moteur à évaluer et à documenter (0.1.x).
- Les tests réseau automatiques ne s'exécutent que sous Linux ; sous Windows, la même
  configuration du moteur s'applique (même lanceur, mêmes options) mais reste à vérifier sur
  un vrai Windows ([docs/TESTING-WINDOWS.md](docs/TESTING-WINDOWS.md)).

Signaler un problème de confidentialité : voir [CONTRIBUTING.md](CONTRIBUTING.md).
