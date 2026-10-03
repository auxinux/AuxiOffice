# Mises à jour : préparation

AuxiNux Office **0.1.0 ne vérifie pas et n'installe pas de mises à jour automatiquement**
(ce qui est accepté pour cette version). L'architecture est préparée pour un futur service de
publication — par exemple sur dep.auxinux.ca — **sans aucune URL codée en dur** tant que ce
service n'est pas officiellement défini.

## 1. Ce qui existe en 0.1.0

### Configuration (`branding/product.json`)

```json
"updates": {
  "enabled": false,
  "default_channel": "stable",
  "channels": ["stable", "beta"],
  "feed_url_template": ""
}
```

- `enabled` : aucune vérification tant que `false` (valeur de 0.1.0).
- `channels` : canaux connus ; `default_channel` : canal des builds par défaut
  (`AUXI_UPDATE_CHANNEL=beta` pour un build de test).
- `feed_url_template` : adresse du futur flux, avec les variables `{channel}`, `{os}`,
  `{arch}` (par exemple `https://<serveur>/auxioffice/{channel}/{os}-{arch}.json`) ; **vide**
  en 0.1.0.

### Métadonnées produites avec chaque paquet

L'étape `package` écrit `dist/<cible>/update-info.json` (`scripts/auxibuild/update_info.py`) :

```json
{
  "schema": 1,
  "product": "AuxiNux Office",
  "app_id": "ca.auxinux.AuxiNuxOffice",
  "version": "0.1.0",
  "build": 0,
  "channel": "stable",
  "os": "windows",
  "arch": "x86_64",
  "date": "2026-10-01T00:00:00Z",
  "built_on": "Linux x86_64",
  "artifacts": [
    {"file": "AuxiNuxOffice-0.1.0-x64.exe", "format": "nsis", "size": 372862659, "sha256": "…"},
    {"file": "AuxiNuxOffice-0.1.0-x64.msi", "format": "msi", "size": 629451776, "sha256": "…"}
  ]
}
```

Ce fichier est destiné à l'outil de publication : il décrit ce qui a été construit (système,
architecture, canal, format, taille, empreinte) sans connaître l'adresse de publication.

## 2. Modèle prévu

| Système | Format | Mécanisme prévu |
|---|---|---|
| Debian / Ubuntu / AuxiNux OS | `.deb` | **dépôt APT signé** (dep.auxinux.ca, quand il sera défini) : `apt upgrade`, aucun code de mise à jour dans l'application |
| Linux (autres) | AppImage | informations de mise à jour AppImage (zsync) intégrées au build quand l'URL sera définie ; mise à jour par AppImageUpdate ou par l'utilisateur |
| Windows 10/11 | `.exe` | vérification dans l'application (désactivable), téléchargement de l'installateur, contrôle de la taille, du SHA-256 et de la signature Authenticode, installation silencieuse (`/S`) après accord de l'utilisateur |
| Windows (parc géré) | `.msi` | déploiement par l'administrateur (GPO, Intune, WSUS tiers) ; vérification automatique désactivée |

Flux (`feed_url_template` résolu) : agrégation des `update-info.json` publiés, avec en plus
l'URL de téléchargement de chaque artefact, l'URL des notes de version et une signature du
flux. Comparaison des versions : `version` (SemVer) puis `build`.

## 3. Règles de confidentialité des futures vérifications

- Désactivées tant que l'utilisateur (ou l'administrateur) ne les a pas acceptées ; réglage
  visible dans les paramètres.
- Simple requête HTTPS d'un fichier statique : **aucun identifiant** d'installation ou
  d'utilisateur, aucune information sur les documents ; seuls le canal, le système et
  l'architecture figurent dans l'URL.
- Fréquence limitée (au plus une fois par jour), jamais pendant l'édition d'un document.
- Rien n'est installé sans l'accord de l'utilisateur ; les paquets sont vérifiés (SHA-256,
  signature) avant installation.

## 4. Travail restant (voir ROADMAP.md)

1. Définir officiellement le service (dep.auxinux.ca) et sa clé de signature.
2. Publier le dépôt APT ; renseigner `feed_url_template` ; ajouter l'information de mise à
   jour de l'AppImage.
3. Signer les installateurs Windows (Authenticode).
4. Implémenter la vérification côté application (Windows), avec le réglage d'acceptation.
