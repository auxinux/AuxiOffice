# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Update metadata (préparation des mises à jour, voir docs/UPDATES.md).

AuxiNux Office 0.1.0 ne vérifie pas les mises à jour. Chaque étape « package » écrit
cependant dist/<cible>/update-info.json, qui décrit les artefacts produits (version, canal,
système, architecture, format, taille, SHA-256) dans le format qu'un futur service de
publication (par ex. dep.auxinux.ca, non défini à ce jour) pourra agréger. Aucune URL n'est
codée en dur : l'adresse du flux viendra de branding/product.json (updates.feed_url_template,
vide en 0.1.0)."""

import hashlib
import json
import os
import platform
from datetime import datetime, timezone

from .common import DIST_DIR, build_number, fail, ok, product, source_date_epoch, version, write_text

SCHEMA = 1
FORMATS = {".deb": "deb", ".AppImage": "appimage", ".exe": "nsis", ".msi": "msi"}


def channel():
    """Canal de publication : AUXI_UPDATE_CHANNEL ou updates.default_channel de product.json."""
    updates = product().get("updates", {})
    value = os.environ.get("AUXI_UPDATE_CHANNEL", updates.get("default_channel", "stable"))
    if value not in updates.get("channels", ["stable"]):
        fail(f"canal de mise à jour inconnu : {value} (canaux : {', '.join(updates.get('channels', []))})")
    return value


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write(target, files):
    """files : artefacts produits par l'étape package pour cette cible."""
    p = product()
    artifacts = []
    for f in sorted(files, key=lambda x: x.name):
        fmt = next((v for k, v in FORMATS.items() if f.name.endswith(k)), None)
        if not fmt:
            continue
        artifacts.append({"file": f.name, "format": fmt, "size": f.stat().st_size, "sha256": _sha256(f)})
    info = {
        "schema": SCHEMA,
        "product": p["product"]["name"],
        "app_id": p["linux"]["app_id"],
        "version": version(),
        "build": build_number(),
        "channel": channel(),
        "os": target,
        "arch": "x86_64",
        "date": datetime.fromtimestamp(source_date_epoch(), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "built_on": f"{platform.system()} {platform.machine()}",
        "artifacts": artifacts,
    }
    dest = write_text(DIST_DIR / target / "update-info.json", json.dumps(info, indent=2, ensure_ascii=False) + "\n")
    ok(f"métadonnées de mise à jour : {dest} (canal {info['channel']})")
    return dest
