# Paquets Linux

Les fichiers d'intégration Linux ne sont pas stockés ici : ils sont **générés au build** par
`scripts/auxibuild/package_linux.py` à partir de `branding/product.json` et de
`packaging/common/filetypes.json`, pour rester cohérents avec l'identité et les types de
fichiers déclarés :

| Fichier généré | Contenu |
|---|---|
| `ca.auxinux.AuxiOffice.desktop` | entrée principale (`auxioffice %F`), types Office et PDF, actions « Nouveau document/feuille de calcul/présentation/fichier texte » |
| `ca.auxinux.AuxiOffice.{Writer,Sheet,Present,PDF}.desktop` | une entrée par application (`auxioffice --app=… %F`) |
| `ca.auxinux.AuxiOffice.Text.desktop` | AuxiText (catégories Utility, TextEditor) |
| `ca.auxinux.AuxiOffice.metainfo.xml` | métadonnées AppStream |
| `DEBIAN/control`, `copyright`, `changelog.gz`, `md5sums` | paquet `.deb` (dépendances calculées par `dpkg-shlibdeps`) |
| `AppRun`, `.desktop` et icône de l'AppDir | AppImage |

Les fichiers `.desktop` sont validés par `desktop-file-validate` pendant l'empaquetage.
Commandes : `./scripts/package-deb.sh`, `./scripts/package-appimage.sh` (voir
[BUILD.md](../../BUILD.md)).
