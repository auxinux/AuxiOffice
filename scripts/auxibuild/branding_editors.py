# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Branding of the editors (upstream web-apps).

Uses the white-label mechanism built into the upstream web-apps build
(environment variables replacing {{APP_TITLE_TEXT}}, {{PUBLISHER_NAME}}...),
renames the editors (AuxiWriter, AuxiSheet, AuxiPresent, AuxiPDF) in every UI
language and adds the French/English strings of the AuxiNux About notices."""

import json
from pathlib import Path

from .common import UPSTREAM_SRC, fail, ok, version, build_number

# préfixe des clés de traduction -> (dossier de l'application, clé d'app dans product.json)
EDITORS = {
    "DE": ("documenteditor", "writer"),
    "SSE": ("spreadsheeteditor", "sheet"),
    "PE": ("presentationeditor", "present"),
    "PDFE": ("pdfeditor", "pdf"),
}

ABOUT_STRINGS = {
    "en": {
        "Common.Views.About.txtAuxiBasedOn": "Based on ONLYOFFICE, originally developed by Ascensio System SIA. This is a modified version (changes by the AuxiNux project since 2026-10-01).",
        "Common.Views.About.txtAuxiIndependent": "AuxiNux Office is an independent project and is not an official product of ONLYOFFICE or Ascensio System SIA.",
        "Common.Views.About.txtAuxiLicense": "Free software licensed under the GNU AGPL v3. ONLYOFFICE is a trademark of Ascensio System SIA.",
    },
    "fr": {
        "Common.Views.About.txtAuxiBasedOn": "Basé sur ONLYOFFICE, développé à l'origine par Ascensio System SIA. Il s'agit d'une version modifiée (modifications du projet AuxiNux depuis le 2026-10-01).",
        "Common.Views.About.txtAuxiIndependent": "AuxiNux Office est un projet indépendant et n'est pas un produit officiel de ONLYOFFICE ou d'Ascensio System SIA.",
        "Common.Views.About.txtAuxiLicense": "Logiciel libre sous licence GNU AGPL v3. ONLYOFFICE est une marque d'Ascensio System SIA.",
    },
}


def webapps_env(p):
    """Variables reconnues par web-apps/build/Gruntfile.js (marqueurs {{...}})."""
    prod = p["product"]
    return {
        "APP_TITLE_TEXT": prod["name"],
        "COMPANY_NAME": "AuxiNux",
        "APP_CUSTOMER_NAME": prod["name"],
        "PUBLISHER_NAME": prod["vendor"],
        "PUBLISHER_URL": prod["website"],
        "PUBLISHER_ADDRESS": "",
        "PUBLISHER_PHONE": "",
        "SUPPORT_EMAIL": "",
        "SUPPORT_URL": prod["support_url"],
        "SALES_EMAIL": "",
        "HELP_URL": prod["website"],
        "HELP_CENTER_WEB_DE": prod["website"],
        "HELP_CENTER_WEB_SSE": prod["website"],
        "HELP_CENTER_WEB_PE": prod["website"],
        "SUGGEST_URL": prod["support_url"],
        "PLUGIN_LINK": "https://api.onlyoffice.com/plugin/basic",
        "PLUGIN_LINK_MACROS": "https://api.onlyoffice.com/plugin/macros",
        "PRODUCT_VERSION": version(),
        "BUILD_NUMBER": str(build_number()),
    }


def _rewrite_json(path, updates):
    data = json.loads(path.read_text(encoding="utf-8"))
    changed = False
    for key, value in updates.items():
        if key in data and data[key] != value or key not in data:
            data[key] = value
            changed = True
    if changed:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def brand_desktop_config(p, apps):
    """Configuration des éditeurs en mode bureau (apps/api/documents/index.html.desktop) :
    liens de support AuxiNux et pas d'aide (aucune aide hors ligne livrée, pas d'aide en ligne)."""
    f = apps / "api" / "documents" / "index.html.desktop"
    text = f.read_text(encoding="utf-8")
    prod = p["product"]
    replacements = [
        ('goback: { url: "onlyoffice.com" }', f'goback: {{ url: "{prod["website"].split("://", 1)[-1]}" }}'),
        ('url: "https://helpdesk.onlyoffice.com/?desktop=true"', f'url: "{prod["support_url"]}"'),
        ('                        , uiTheme: urlParams["uitheme"]',
         '                        , help: false\n                        , uiTheme: urlParams["uitheme"]'),
    ]
    for old, new in replacements:
        if old not in text:
            fail(f"motif upstream introuvable dans {f.name} : {old!r} (fichier modifié upstream ?)")
        text = text.replace(old, new, 1)
    f.write_text(text, encoding="utf-8")


def apply(p, args):
    apps = UPSTREAM_SRC / "web-apps" / "apps"
    if not apps.exists():
        return
    brand_desktop_config(p, apps)
    count = 0
    for prefix, (folder, app_key) in EDITORS.items():
        name = p["apps"][app_key]["name"]
        for locale in sorted((apps / folder / "main" / "locale").glob("*.json")):
            data = json.loads(locale.read_text(encoding="utf-8"))
            key = f"{prefix}.Views.LeftMenu.txtEditor"
            if data.get(key) != name:
                data[key] = name
                locale.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                count += 1
    # Les chaînes « Common.* » sont dupliquées dans le dossier locale de chaque éditeur ;
    # les autres langues reçoivent l'anglais via translation/merge_and_check.py (étape build).
    for folder in ("documenteditor", "spreadsheeteditor", "presentationeditor", "pdfeditor", "visioeditor"):
        for lang, strings in ABOUT_STRINGS.items():
            target = apps / folder / "main" / "locale" / f"{lang}.json"
            if target.exists():
                _rewrite_json(target, strings)
    ok(f"éditeurs : noms AuxiNux appliqués ({count} fichiers de langue), mentions « À propos » FR/EN")
