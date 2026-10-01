# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Branding of the start page, the shell resources and the editors (web-apps):
AuxiNux assets from branding/generated replace the upstream logos and icons,
and the AuxiNux front-end modules are copied next to the upstream sources."""

import json
import shutil
from pathlib import Path

from .common import ROOT, UPSTREAM_SRC, fail, ok, version, write_text

GEN = ROOT / "branding" / "generated"

# (fichier généré, destination relative à upstream/src/desktop-apps)
DESKTOP_APPS_ASSETS = [
    # Page d'accueil : logos (À propos) et illustration d'accueil
    ("svg/auxioffice.svg", "common/loginpage/res/img/idx-logo-light.svg"),
    ("svg/auxioffice.svg", "common/loginpage/res/img/idx-logo-dark.svg"),
    ("svg/welcome-light.svg", "common/loginpage/res/img/welcome-light.svg"),
    ("svg/welcome-dark.svg", "common/loginpage/res/img/welcome-dark.svg"),
    ("svg/txt-big.svg", "common/loginpage/res/img/common-svg/txt-big.svg"),
    ("svg/txt-big-dark.svg", "common/loginpage/res/img/common-svg/txt-big-dark.svg"),
    # Shell natif : logo de la barre d'onglets et icône d'application
    ("svg/shell-logo-light.svg", "win-linux/res/icons/logo_light.svg"),
    ("png/shell-logo-light.png", "win-linux/res/icons/logo_light.png"),
    ("png/shell-logo-light@1.25x.png", "win-linux/res/icons/logo_light@1.25x.png"),
    ("png/shell-logo-light@1.5x.png", "win-linux/res/icons/logo_light@1.5x.png"),
    ("png/shell-logo-light@1.75x.png", "win-linux/res/icons/logo_light@1.75x.png"),
    ("svg/shell-logo-dark.svg", "win-linux/res/icons/logo_dark.svg"),
    ("png/shell-logo-dark.png", "win-linux/res/icons/logo_dark.png"),
    ("png/shell-logo-dark@1.25x.png", "win-linux/res/icons/logo_dark@1.25x.png"),
    ("png/shell-logo-dark@1.5x.png", "win-linux/res/icons/logo_dark@1.5x.png"),
    ("png/shell-logo-dark@1.75x.png", "win-linux/res/icons/logo_dark@1.75x.png"),
    ("ico/auxioffice.ico", "win-linux/res/icons/desktopeditors.ico"),
    ("png/64x64/auxioffice.png", "win-linux/res/icons/app-icon_64.png"),
    # Écran de démarrage (compilé dans les ressources du shell)
    ("svg/splash.svg", "win-linux/res/icons/splash.svg"),
]


def _lighter(hex_color, factor=1.18):
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
    r, g, b = (int(v + (255 - v) * (factor - 1)) for v in (r, g, b))
    return f"#{r:02X}{g:02X}{b:02X}"


def startpage_config(p):
    apps = p["apps"]
    colors = {k: [_lighter(apps[k]["color"]), apps[k]["color"]] for k in ("writer", "sheet", "present", "pdf", "text")}
    colors["open"] = [p["colors"]["accent"], p["colors"]["primary"]]
    return {
        "productName": p["product"]["name"],
        "version": version(),
        "website": p["product"]["website"],
        "websiteLabel": p["product"]["website"].split("://", 1)[-1],
        "colors": colors,
    }


def brand_startpage_and_shell(p):
    base = UPSTREAM_SRC / "desktop-apps"
    if not base.exists():
        return
    for src, dst in DESKTOP_APPS_ASSETS:
        s = GEN / src
        if not s.exists():
            fail(f"ressource de branding manquante : {s} (lancer branding/tools/generate_assets.py)")
        d = base / dst
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(s, d)
    loginpage = base / "common" / "loginpage" / "src"
    shutil.copy2(ROOT / "src" / "startpage" / "auxinux.js", loginpage / "auxinux.js")
    cfg = json.dumps(startpage_config(p), ensure_ascii=False, indent=2)
    write_text(loginpage / "auxinux_branding.js",
               "/* Généré par scripts/auxibuild/branding_web.py depuis branding/product.json — ne pas modifier. */\n"
               f"window.AUXINUX_BRANDING = {cfg};\n")
    ok("page d'accueil et ressources du shell : identité AuxiNux appliquée")


def apply(p, args):
    brand_startpage_and_shell(p)
    from . import branding_editors
    branding_editors.apply(p, args)
