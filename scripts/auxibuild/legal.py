# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Legal files installed with AuxiNux Office: LICENSE.txt, NOTICE.txt (with the
list of AuxiNux modifications of this build) and licenses/ (third-party notices
plus an index page opened from « À propos > Logiciels libres et licences »)."""

import html
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from .common import ROOT, UPSTREAM_SRC, fail, lock, product, source_date_epoch, version, write_text
from .fetch import THIRD_PARTY_DIR

THIRD_PARTY_FILES = [
    # (fichier source, nom installé, description FR, description EN)
    ("desktop-apps/package/common/license/3dparty/3DPARTYLICENSE", "3DPARTY-desktop.txt",
     "Composants du shell : Chromium Embedded Framework, Qt 5 (LGPL v3), jQuery, Bootstrap…",
     "Shell components: Chromium Embedded Framework, Qt 5 (LGPL v3), jQuery, Bootstrap…"),
    ("core/3DPARTY.md", "3DPARTY-core.md", "Composants du moteur de conversion (core)",
     "Conversion engine components (core)"),
    ("desktop-sdk/3DPARTY.md", "3DPARTY-desktop-sdk.md", "Composants du SDK bureau", "Desktop SDK components"),
    ("web-apps/3DPARTY.md", "3DPARTY-web-apps.md", "Composants de l'interface des éditeurs",
     "Editor user interface components"),
    ("sdkjs/3DPARTY.md", "3DPARTY-sdkjs.md", "Composants du moteur JavaScript des éditeurs",
     "Editor JavaScript engine components"),
]


def patch_subjects():
    entries = []
    for patch in sorted((ROOT / "patches").glob("*/*.patch")):
        subject = ""
        for line in patch.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith("Subject:"):
                subject = re.sub(r"^Subject:\s*(\[PATCH[^\]]*\]\s*)?", "", line).strip()
                break
        entries.append((patch.parent.name, patch.name, subject))
    return entries


def notice_text(target):
    up = lock()["upstream"]
    repos = lock()["repositories"]
    lines = [(ROOT / "NOTICE").read_text(encoding="utf-8").rstrip(), "",
             "=" * 79,
             f"Version : AuxiNux Office {version()} ({target}) — "
             f"générée le {datetime.fromtimestamp(source_date_epoch(), timezone.utc).strftime('%Y-%m-%d')}",
             f"Programme d'origine : {up['product']} {up['version']} (build {up['build']}, étiquette {up['source_tag']})",
             "", "Sources upstream utilisées (commits) :"]
    for name, spec in repos.items():
        lines.append(f"  - {name:<15} {spec['commit']}  {spec['url']}")
    lines += ["", "Modifications AuxiNux du code upstream incluses dans cette version :"]
    for repo, name, subject in patch_subjects():
        lines.append(f"  - [{repo}] {subject}  ({name})")
    lines += ["",
              "Composants propres à AuxiNux : AuxiText (éditeur de texte), lanceur auxioffice,",
              "extensions du shell (src/shell) et de la page d'accueil (src/startpage), identité visuelle.",
              "",
              "Le code source correspondant (dépôt AuxiNux Office : patches, sources propres, scripts de",
              f"build et verrou upstream) est disponible auprès du projet AuxiNux : {product()['product']['source_url']}",
              ""]
    return "\n".join(lines)


def _li(href, label, desc):
    return f'<li><a href="{html.escape(href)}">{html.escape(label)}</a> — {html.escape(desc)}</li>'


def index_html(target, extra_components):
    p = product()
    up = lock()["upstream"]
    qt = "5.9.9" if target == "linux" else "5.15.2"
    tp = "\n".join(_li(name, name, fr) for _, name, fr, _ in THIRD_PARTY_FILES)
    tp_en = "\n".join(_li(name, name, en) for _, name, _, en in THIRD_PARTY_FILES)
    extra = "\n".join(_li(href, label, desc) for href, label, desc in extra_components)
    return f"""<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>{p['product']['name']} — Logiciels libres et licences</title>
<style>
 body {{ font-family: sans-serif; max-width: 900px; margin: 2em auto; padding: 0 1em; line-height: 1.5; color: #23252A; }}
 h1 {{ color: #C85A00; }} h2 {{ border-bottom: 2px solid #F26F00; padding-bottom: .2em; }}
 .en {{ color: #555; }} code {{ background: #F1F1EF; padding: 0 .3em; }}
</style></head><body>
<h1>{p['product']['name']} {version()} — Logiciels libres et licences</h1>

<p>{p['product']['name']} est un logiciel libre développé dans le cadre du projet AuxiNux
(<a href="{p['product']['website']}">{p['product']['website']}</a>).
{p['product']['name']} utilise et modifie des composants provenant de <b>{up['product']} {up['version']}</b>,
développé à l'origine par <b>Ascensio System SIA</b>.</p>
<p>{p['product']['name']} est un projet indépendant et n'est pas un produit officiel de ONLYOFFICE ou
d'Ascensio System SIA. ONLYOFFICE est une marque d'Ascensio System SIA ; aucun droit de marque n'est accordé.</p>
<p>Il s'agit d'une <b>version modifiée</b> : modifications apportées par le projet AuxiNux depuis le
{p['product']['modification_start_date']}, détaillées dans <a href="../NOTICE.txt">NOTICE.txt</a>.</p>

<h2>Licence principale</h2>
<ul>
{_li('../LICENSE.txt', 'LICENSE.txt', "GNU Affero General Public License v3 et conditions additionnelles du programme d'origine")}
{_li('AGPL-3.0.txt', 'AGPL-3.0.txt', 'Texte de la GNU Affero General Public License version 3')}
{_li('../NOTICE.txt', 'NOTICE.txt', 'Mentions, attribution et liste des modifications AuxiNux')}
</ul>
<p>Code source : <a href="{p['product']['source_url']}">{p['product']['source_url']}</a> (dépôt AuxiNux Office) et
<a href="{p['upstream']['url']}">{p['upstream']['url']}</a> (programme d'origine, étiquette <code>{up['source_tag']}</code>).</p>

<h2>Composants tiers</h2>
<ul>
{tp}
{_li('ICU-LICENSE.txt', 'ICU-LICENSE.txt', 'International Components for Unicode (licence Unicode)')}
{extra}
</ul>
<p>Qt {qt} est utilisé sous licence GNU LGPL v3 (bibliothèques partagées remplaçables, texte dans
<code>3DPARTY-desktop.txt</code>). Sources : <a href="https://download.qt.io/archive/qt/">download.qt.io/archive/qt</a>.</p>
<p>Les éléments non logiciels d'origine ONLYOFFICE (illustrations, jeux d'icônes, rédaction technique) sont sous licence
<a href="https://creativecommons.org/licenses/by-sa/4.0/legalcode">CC BY-SA 4.0</a>.
L'identité visuelle AuxiNux est sous CC BY-SA 4.0 ; ses lettres dérivent de la police Carlito
(<a href="OFL-1.1-Carlito.txt">SIL OFL 1.1</a>).</p>

<h2 class="en">English</h2>
<p class="en">{p['product']['name']} is free software developed by the AuxiNux project. It uses and modifies components of
{up['product']} {up['version']}, originally developed by Ascensio System SIA. It is an independent project, not an official
product of ONLYOFFICE or Ascensio System SIA. ONLYOFFICE is a trademark of Ascensio System SIA. This is a modified version
(changes by the AuxiNux project since {p['product']['modification_start_date']}, see NOTICE.txt). Main license: GNU AGPL v3
with the additional terms of the original program. Third-party notices:</p>
<ul class="en">
{tp_en}
</ul>
</body></html>
"""


def install_legal_files(stage, target, extra_components=()):
    """Write LICENSE.txt, NOTICE.txt and licenses/ into the staged install tree."""
    stage = Path(stage)
    lic = stage / "licenses"
    lic.mkdir(parents=True, exist_ok=True)
    upstream_license = UPSTREAM_SRC / "desktop-apps" / "LICENSE"
    if not upstream_license.exists():
        fail("licence upstream introuvable (étape fetch)")
    # La licence du programme distribué : AGPL v3 + conditions additionnelles d'origine.
    shutil.copy2(upstream_license, stage / "LICENSE.txt")
    shutil.copy2(upstream_license, lic / "ONLYOFFICE-LICENSE.txt")
    shutil.copy2(ROOT / "LICENSE", lic / "AGPL-3.0.txt")
    shutil.copy2(ROOT / "branding" / "fonts" / "OFL-1.1.txt", lic / "OFL-1.1-Carlito.txt")
    icu = THIRD_PARTY_DIR / "icu74" / "LICENSE"
    if icu.exists():
        shutil.copy2(icu, lic / "ICU-LICENSE.txt")
    for src, name, _, _ in THIRD_PARTY_FILES:
        f = UPSTREAM_SRC / src
        if not f.exists():
            fail(f"fichier de licence tiers manquant : {f}")
        shutil.copy2(f, lic / name)
    write_text(stage / "NOTICE.txt", notice_text(target))
    write_text(lic / "index.html", index_html(target, extra_components))
