#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Write a module-definition (.def) file listing the named exports of a PE DLL.
Used with llvm-dlltool to build MSVC import libraries for upstream DLLs."""
import os
import sys

import pefile

dll, out = sys.argv[1], sys.argv[2]
pe = pefile.PE(dll, fast_load=True, max_symbol_exports=1 << 20)
pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_EXPORT"]])
names = [s.name.decode() for s in pe.DIRECTORY_ENTRY_EXPORT.symbols if s.name]
with open(out, "w") as f:
    f.write('LIBRARY "%s"\nEXPORTS\n' % os.path.basename(dll))
    for n in names:
        f.write("    %s\n" % n)
