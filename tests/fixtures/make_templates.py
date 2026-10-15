#!/usr/bin/env python3
"""Régénère les modèles vierges d'AuxiOffice (app/src-tauri/templates).

Styles proches des valeurs par défaut de Microsoft Office (Calibri 11,
présentations 16:9) ; LibreOffice substitue Carlito, aux métriques
identiques, quand Calibri est absent.
Dépendances : python-docx, openpyxl, python-pptx.
"""

import sys
from pathlib import Path

from docx import Document
from docx.shared import Pt
from openpyxl import Workbook
from pptx import Presentation
from pptx.util import Inches

out = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / "app/src-tauri/templates")
out.mkdir(parents=True, exist_ok=True)

doc = Document()
normal = doc.styles["Normal"]
normal.font.name = "Calibri"
normal.font.size = Pt(11)
doc.core_properties.author = ""
doc.core_properties.title = ""
doc.save(out / "vierge.docx")

wb = Workbook()
wb.active.title = "Feuille1"
wb.properties.creator = ""
wb.save(out / "vierge.xlsx")

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
slide = prs.slides.add_slide(prs.slide_layouts[0])
prs.core_properties.author = ""
prs.save(out / "vierge.pptx")

for f in sorted(out.iterdir()):
    print(f.name, f.stat().st_size)
