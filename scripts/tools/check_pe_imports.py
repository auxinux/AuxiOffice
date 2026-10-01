#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Verify that every symbol imported by a PE binary is exported by the DLLs found
in the given directories (DLLs not found there are treated as system DLLs).
Exit code 1 when an import is unresolved: such a binary would not start."""
import os
import sys

import pefile

exe, dirs = sys.argv[1], sys.argv[2:]
cache = {}


def find(dll):
    for d in dirs:
        for f in os.listdir(d):
            if f.lower() == dll.lower():
                return os.path.join(d, f)
    return None


def exports(path):
    if path not in cache:
        pe = pefile.PE(path, fast_load=True, max_symbol_exports=1 << 20)
        pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_EXPORT"]])
        cache[path] = ({s.name.decode() for s in pe.DIRECTORY_ENTRY_EXPORT.symbols if s.name}
                       if hasattr(pe, "DIRECTORY_ENTRY_EXPORT") else set())
    return cache[path]


pe = pefile.PE(exe, fast_load=True)
pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_IMPORT"]])
missing, checked, system = 0, 0, set()
for entry in pe.DIRECTORY_ENTRY_IMPORT:
    dll = entry.dll.decode()
    path = find(dll)
    if not path:
        system.add(dll)
        continue
    ex = exports(path)
    for imp in entry.imports:
        if imp.name is None:
            continue
        checked += 1
        if imp.name.decode() not in ex:
            missing += 1
            print("MANQUANT", dll, imp.name.decode())
print(f"{os.path.basename(exe)} : {checked} imports vérifiés, {missing} manquant(s) ; DLL système : {', '.join(sorted(system))}")
sys.exit(1 if missing else 0)
