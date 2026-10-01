# AuxiMail : étude technique

**Statut : étude.** AuxiMail ne fait pas partie d'AuxiNux Office 0.1.0 et **aucun client de
messagerie (ni Thunderbird) n'y est intégré.** Ce document compare les options possibles et
propose une démarche.

## 1. Besoins

Un client de messagerie pour l'écosystème AuxiNux, cohérent avec ses principes (logiciel
libre, vie privée, local d'abord, sans compte imposé), sous Linux et Windows :

- comptes IMAP/SMTP (et POP3), plusieurs comptes, dossiers, recherche, mode hors ligne ;
- authentification moderne : **OAuth2** (obligatoire pour Gmail et Microsoft 365), mots de
  passe d'application, stockage sûr des secrets ;
- **Microsoft 365 / Exchange** ;
- calendrier (CalDAV, invitations iCalendar/iTIP), contacts et carnets d'adresses (CardDAV,
  LDAP), notifications du système ;
- chiffrement (OpenPGP, S/MIME), filtres, indésirables ;
- intégration avec AuxiNux Office : « Envoyer par courriel » depuis les éditeurs, ouverture
  des pièces jointes dans AuxiWriter/AuxiSheet/AuxiPresent/AuxiPDF.

Contexte technique à prendre en compte :

- **Gmail** : l'accès IMAP/SMTP se fait par OAuth2 (ou mot de passe d'application avec la
  validation en deux étapes). Un client qui utilise son propre identifiant OAuth avec la
  portée Gmail complète (`https://mail.google.com/`, portée « restreinte ») doit passer la
  vérification de Google et une évaluation de sécurité annuelle au-delà d'un petit nombre
  d'utilisateurs : coût et démarches importants.
- **Microsoft 365** : OAuth2 obligatoire (l'authentification de base est retirée), application
  à enregistrer dans Microsoft Entra ID (multi-locataire, éditeur vérifié). Pour les fonctions
  Exchange (calendrier, contacts, carnet global), Microsoft retire EWS d'Exchange Online
  (blocage progressif annoncé à partir d'octobre 2026) au profit de **Microsoft Graph**.
- Un client de messagerie traite en permanence du contenu **non fiable** (HTML, images, pièces
  jointes, en-têtes) : les correctifs de sécurité doivent être livrés en quelques jours.

## 2. Options

### Option A — Fork de Thunderbird

Reprendre le code de Thunderbird (comm-central + plateforme Gecko de mozilla-central),
le renommer « AuxiMail » et le publier.

- **Licence** : MPL 2.0 (copyleft au niveau des fichiers), compatible avec l'écosystème. Le
  nom et le logo Thunderbird sont des marques : une version modifiée doit changer de nom et
  d'identité (c'est le cas des forks comme Betterbird).
- **Maintenance** : très lourde. Base de code de la taille d'un navigateur (Gecko, Rust,
  C++, JavaScript) ; build de plusieurs heures et de dizaines de Go par plateforme ;
  synchronisation avec chaque version (ESR annuelle, versions mensuelles) et chaque
  correctif de sécurité (cycle de quatre semaines, parfois en urgence) ; infrastructure de
  build, de signature et de mise à jour à créer.
- **Sécurité** : bonne au départ (code audité, OpenPGP intégré), mais tout retard de
  synchronisation expose les utilisateurs ; c'est le risque principal d'un petit projet.
- **Fonctions** : complètes — IMAP/POP3/SMTP, OAuth2 (Gmail, Microsoft 365, Yahoo, Fastmail…),
  Exchange (prise en charge native récente, Graph en cours), calendrier (CalDAV, ICS,
  invitations), contacts (CardDAV, LDAP), notifications, filtres, OpenPGP et S/MIME, mode
  hors ligne. Les identifiants OAuth d'upstream appartiennent à leur éditeur : un fork doit
  enregistrer et faire vérifier les siens (Google, Microsoft).
- **Intégration AuxiNux** : très bonne (identité, réglages par défaut, liens avec AuxiNux
  Office).

### Option B — Application séparée basée sur un client existant, sans fork

AuxiMail désigne une application **séparée** d'AuxiNux Office, construite sur un client libre
maintenu par ailleurs, configurée plutôt que modifiée :

- **B1 — Thunderbird non modifié + configuration AuxiNux** : binaires officiels (ou paquet
  Debian), réglages par défaut via les stratégies d'entreprise (`policies.json` : pas de
  télémétrie, confidentialité renforcée, modules), extensions éventuelles, intégration au
  menu et à AuxiNux Office. Mises à jour et sécurité assurées par Mozilla/MZLA ou Debian.
  Contrepartie : l'application garde le nom et l'identité de Thunderbird (pas de « AuxiMail »
  sans accord de marque) ; la personnalisation se limite à ce que permettent les stratégies
  et les extensions.
- **B2 — autre client libre** : Evolution, Geary, KMail (Linux seulement), Claws Mail
  (Windows peu suivi). Aucun n'offre aujourd'hui, à la fois sous Linux et Windows, le niveau
  de Thunderbird (OAuth2 Gmail/Microsoft 365, calendrier, contacts).

Évaluation (B1) : **licence** MPL 2.0, sans contrainte nouvelle ; **maintenance** faible
(configuration et intégration seulement) ; **sécurité** assurée par upstream ;
**fonctions** identiques à l'option A ; **identité** limitée.

### Option C — Intégration légère

Pas de client de messagerie AuxiNux : AuxiNux Office s'appuie sur le client choisi par
l'utilisateur.

- « Envoyer par courriel » depuis les éditeurs : le module « Envoyer » d'upstream, présent
  dans 0.1.0, ouvre un nouveau message avec le document en pièce jointe dans un client
  détecté par le moteur (Thunderbird ou Outlook, aux emplacements d'installation standard),
  sinon un lien `mailto:` (client par défaut du système, sans pièce jointe) ; détection à
  étendre (client par défaut de Linux et de Windows) ;
- liens `mailto:` ouverts dans le client par défaut ; ouverture des pièces jointes Office et
  PDF dans AuxiNux Office (associations de fichiers déjà en place) ;
- sur AuxiNux OS : un client recommandé (par exemple Thunderbird, option B1) installé et
  préconfiguré par la distribution.

Évaluation : **licence** aucune contrainte ; **maintenance** quasi nulle ; **sécurité**
déléguée au client choisi ; **fonctions** celles du client de l'utilisateur ; **identité**
aucune.

### Option D — Client AuxiNux développé de zéro

Écrire AuxiMail (par exemple en Qt/C++ comme AuxiText, ou en Rust) avec des bibliothèques
IMAP/SMTP/MIME existantes.

- **Licence** : libre (AGPL ou autre), maîtrise complète.
- **Maintenance** : la plus élevée — synchronisation IMAP robuste (IDLE, CONDSTORE/QRESYNC,
  reprise hors ligne), stockage et recherche locaux, rendu HTML sûr (isolement, blocage des
  contenus distants), OAuth2 et vérifications Google/Microsoft, Microsoft Graph, CalDAV,
  CardDAV, LDAP, iTIP, OpenPGP, S/MIME, notifications, accessibilité, traductions.
- **Sécurité** : risque élevé (analyse de contenu non fiable par un code jeune) ; audit
  externe indispensable.
- **Fonctions** : à construire, plusieurs années pour approcher Thunderbird.
- **Identité** : complète.

## 3. Comparaison

| Critère | A — fork Thunderbird | B1 — Thunderbird configuré | C — intégration légère | D — client propre |
|---|---|---|---|---|
| Licence | MPL 2.0, changement de nom obligatoire | MPL 2.0, nom Thunderbird conservé | — | au choix |
| Effort initial | élevé (build, renommage, infrastructure) | faible | très faible | très élevé |
| Maintenance | très élevée (suivi ESR et sécurité) | faible | quasi nulle | très élevée |
| Sécurité | dépend de la réactivité AuxiNux | upstream | client choisi | risque élevé |
| IMAP / SMTP / POP3 | oui | oui | client choisi | à développer |
| OAuth2 Gmail / Microsoft 365 | oui, identifiants AuxiNux à faire vérifier | oui (identifiants d'upstream) | client choisi | à développer + vérifications |
| Microsoft 365 / Exchange | oui (évolue vers Graph) | oui | client choisi | Graph à développer |
| Calendrier (CalDAV, invitations) | oui | oui | client choisi | à développer |
| Contacts, carnets (CardDAV, LDAP) | oui | oui | client choisi | à développer |
| Notifications | oui | oui | client choisi | à développer |
| Intégration AuxiNux Office | forte | moyenne | moyenne | forte |
| Identité AuxiNux | complète | non | non | complète |

## 4. Recommandation

1. **0.2.x — option C** : vérifier et documenter « Envoyer par courriel » sous Linux et
   Windows, les liens `mailto:` et l'ouverture des pièces jointes ; aucun client intégré.
2. **AuxiNux OS — option B1** : Thunderbird non modifié, préconfiguré par stratégies
   d'entreprise (confidentialité, télémétrie désactivée), proposé comme client de messagerie
   de la distribution, avec les mises à jour de sécurité de Debian/Mozilla. Calendrier et
   contacts sont couverts par la même application, ce qui réduit le besoin d'AuxiCalendar et
   d'AuxiContacts séparés.
3. **Option A seulement si** le projet dispose durablement d'au moins deux personnes pour la
   maintenance, d'une infrastructure de build/signature/mises à jour pour Linux et Windows,
   et d'un engagement de publication des correctifs de sécurité sous quelques jours. Avant
   toute décision : valider avec Mozilla les règles de marque et de nommage, et estimer le coût
   des vérifications OAuth Google et Microsoft.
4. **Option D déconseillée** : coût et risques de sécurité disproportionnés.

## 5. Prochaines étapes

- Tester le module « Envoyer » d'AuxiNux Office avec Thunderbird et Outlook, et étendre la
  détection au client par défaut du système (`xdg-email` sous Linux, MAPI sous Windows) ;
  ajouter le scénario aux plans de test.
- Rédiger un `policies.json` AuxiNux pour Thunderbird (télémétrie et études désactivées,
  contenu distant bloqué par défaut, page d'accueil locale) et le tester sous Linux et Windows.
- Réexaminer la décision A/B1 avant la feuille de route « AuxiMail » (voir ROADMAP.md).
