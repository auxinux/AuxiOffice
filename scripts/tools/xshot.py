#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Grab a screenshot of an X display (root window) to PNG. Usage: xshot.py out.png [display]"""
import sys
from Xlib import display, X
from PIL import Image
out = sys.argv[1]
d = display.Display(sys.argv[2] if len(sys.argv) > 2 else None)
root = d.screen().root
g = root.get_geometry()
raw = root.get_image(0, 0, g.width, g.height, X.ZPixmap, 0xffffffff)
img = Image.frombytes("RGB", (g.width, g.height), raw.data, "raw", "BGRX")
img.save(out)
print(out, g.width, g.height)
