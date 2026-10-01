#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Vérifie qu'un binaire ELF peut résoudre tous ses symboles dynamiques avec les
bibliothèques réellement livrées (répertoire d'installation), en tenant compte
des versions de symboles. Les bibliothèques système (glibc, GTK, X11…) absentes
du répertoire sont ignorées. Code de sortie 1 en cas de symbole introuvable."""
import re
import subprocess
import sys
from pathlib import Path

binary, libdirs = Path(sys.argv[1]), [Path(d) for d in sys.argv[2:]]
SYM_RE = re.compile(r"^\S+\s+\S+\s+(\S+)\s+(\S+)\s+\S+\s+\(?([^\s)]*)\)?\s*(\S+)$")


def dyn_symbols(path):
    """[(name, version, defined)] depuis objdump -T."""
    out = subprocess.run(["objdump", "-T", str(path)], capture_output=True, text=True).stdout
    syms = []
    for line in out.splitlines():
        parts = line.split()
        if len(parts) < 4 or not re.match(r"^[0-9a-f]{8,}$", parts[0]):
            continue
        name = parts[-1]
        version = parts[-2] if parts[-2] not in ("Base",) else ""
        version = version.strip("()")
        defined = "*UND*" not in line
        syms.append((name, version, defined))
    return syms


def needed(path):
    out = subprocess.run(["readelf", "-d", str(path)], capture_output=True, text=True).stdout
    return re.findall(r"\(NEEDED\)\s+Shared library: \[([^\]]+)\]", out)


provided = {}
missing_libs = []
for lib in needed(binary):
    path = next((d / lib for d in libdirs if (d / lib).exists()), None)
    if path is None:
        continue   # bibliothèque système
    for name, version, defined in dyn_symbols(path):
        if defined:
            provided.setdefault(name, set()).add(version)

bundled_versions = {v for vs in provided.values() for v in vs if v}
bad = 0
for name, version, defined in dyn_symbols(binary):
    if defined:
        continue
    if version and version not in bundled_versions:
        continue   # symbole versionné d'une bibliothèque système (GLIBC_*, …)
    if name in provided and (not version or version in provided[name]):
        continue
    if version in bundled_versions:
        bad += 1
        print(f"INTROUVABLE {name} @{version}")
print(f"{binary.name} : symboles dynamiques vérifiés contre {', '.join(str(d) for d in libdirs)} — {bad} introuvable(s)")
sys.exit(1 if bad else 0)
