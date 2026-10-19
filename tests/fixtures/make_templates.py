#!/usr/bin/env python3
"""Régénère les modèles vierges d'AuxiOffice (app/src-tauri/templates).

Styles proches des valeurs par défaut de Microsoft Office (Calibri 11,
présentations 16:9) ; LibreOffice substitue Carlito, aux métriques
identiques, quand Calibri est absent.
Dépendances : python-docx, openpyxl, python-pptx.
"""

import re
import shutil
import sys
import tempfile
import zipfile
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


def to_french(path: Path):
    """Langue des modèles : français du Canada (python-docx et python-pptx
    écrivent en-US, et LibreOffice vérifierait le texte avec le dictionnaire anglais)."""
    tmp = Path(tempfile.mkdtemp()) / path.name
    with zipfile.ZipFile(path) as src, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            data = src.read(item.filename)
            if item.filename.endswith(".xml"):
                t = data.decode("utf-8")
                t = re.sub(r'(<w:(?:lang|themeFontLang)\b[^>]*\bw:val=")en-US"', r'\1fr-CA"', t)
                t = re.sub(r'(<a:(?:rPr|defRPr|endParaRPr)\b[^>]*\blang=")en-US"', r'\1fr-CA"', t)
                data = t.encode("utf-8")
            dst.writestr(item, data)
    shutil.move(tmp, path)


to_french(out / "vierge.docx")
to_french(out / "vierge.pptx")

for f in sorted(out.iterdir()):
    print(f.name, f.stat().st_size)
