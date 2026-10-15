# Identité visuelle d'AuxiOffice

```text
branding/
  product.json              description du produit (nom, applications, couleurs, identifiants)
  generated/                ressources générées et versionnées (svg, png, ico, bmp)
  tools/generate_assets.py  générateur des ressources
  fonts/                    Carlito Bold Italic (SIL OFL 1.1), contours des lettres des logos
```

- `product.json` : nom (« AuxiOffice »), éditeur, site (office.auxinux.ca), licence, moteur
  (LibreOffice, avec la mention de marque), applications AuxiWriter / AuxiSheet / AuxiPresent
  (nom, couleur, lettre, extensions), identifiants Linux et Windows, couleurs.
- `generated/` : icônes des applications et des types de fichiers (16 à 512 px, `.ico`),
  logo « AuxiOffice » clair et sombre, illustrations, écran de démarrage.
- L'interface utilise des copies de `generated/svg/` dans `app/ui/public/`.

Régénérer (outil de mainteneur ; nécessite fontTools, cairosvg et Pillow) :

```sh
python3 branding/tools/generate_assets.py
```

Couleurs : orange AuxiNux `#F26F00`, ambre `#F2B713`, graphite `#23252A`, argent `#B7B9BA`.
