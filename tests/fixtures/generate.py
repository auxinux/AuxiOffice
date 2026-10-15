#!/usr/bin/env python3
"""Génère les documents de test d'AuxiOffice (DOCX, XLSX, PPTX).

Ces documents remplacent des fichiers réels : ils couvrent les éléments
courants (styles, tableaux, images, en-têtes, formules, diapositives) et
servent aux tests du moteur et au banc de fidélité.

Dépendances (outillage de test uniquement) : python-docx, openpyxl,
python-pptx, Pillow.
Utilisation : generate.py <dossier de sortie>
"""

import sys
from pathlib import Path

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.shared import Cm, Pt, RGBColor
from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from PIL import Image, ImageDraw
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor as PptColor
from pptx.enum.chart import XL_CHART_TYPE
from pptx.enum.shapes import MSO_SHAPE
from pptx.util import Inches
from pptx.util import Pt as PPt

LOREM = (
    "AuxiOffice est la suite bureautique de l'écosystème AuxiNux. Ce paragraphe "
    "contient des accents (é, è, à, ç, ô, œ), des guillemets « français » et des "
    "nombres comme 1 234,56 $ afin de vérifier la mise en page et la césure. "
)


def make_image(path: Path) -> Path:
    img = Image.new("RGB", (480, 270), (0x1F, 0x4E, 0x79))
    d = ImageDraw.Draw(img)
    for i in range(0, 480, 40):
        d.rectangle([i, 200 - i // 4, i + 30, 270], fill=(0xF2, 0xA9, 0x00))
    d.ellipse([20, 20, 120, 120], fill=(255, 255, 255))
    img.save(path)
    return path


def docx_simple(out: Path) -> None:
    doc = Document()
    doc.add_heading("Lettre de bienvenue", level=1)
    p = doc.add_paragraph("Bonjour, ")
    p.add_run("texte en gras").bold = True
    p.add_run(", ")
    p.add_run("en italique").italic = True
    p.add_run(" et ")
    r = p.add_run("en couleur")
    r.font.color.rgb = RGBColor(0xC0, 0x39, 0x2B)
    p.add_run(".")
    doc.add_paragraph(LOREM)
    doc.save(out / "simple.docx")


def docx_report(out: Path, img: Path) -> None:
    doc = Document()
    sec = doc.sections[0]
    sec.top_margin = Cm(2.5)
    sec.header.paragraphs[0].text = "Rapport annuel AuxiNux — confidentiel"
    sec.footer.paragraphs[0].text = "Projet AuxiNux · office.auxinux.ca"
    sec.footer.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER

    title = doc.add_paragraph("Rapport annuel 2026", style="Title")
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_paragraph("Sommaire des activités", style="Subtitle")

    for chap in range(1, 6):
        doc.add_heading(f"{chap}. Chapitre {chap}", level=1)
        for sub in range(1, 3):
            doc.add_heading(f"{chap}.{sub} Section", level=2)
            for _ in range(3):
                para = doc.add_paragraph(LOREM * 3)
                para.paragraph_format.first_line_indent = Cm(0.8)
                para.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        doc.add_paragraph("Points clés :")
        for k in range(3):
            doc.add_paragraph(f"Élément important numéro {k + 1}", style="List Bullet")
        for k in range(3):
            doc.add_paragraph(f"Étape {k + 1}", style="List Number")
        if chap == 2:
            doc.add_picture(str(img), width=Cm(12))
            doc.add_paragraph("Figure 1 — Évolution des ventes", style="Caption")
        if chap == 3:
            table = doc.add_table(rows=1, cols=4)
            table.style = "Light Grid Accent 1"
            table.alignment = WD_TABLE_ALIGNMENT.CENTER
            for i, h in enumerate(["Région", "T1", "T2", "Total"]):
                table.rows[0].cells[i].text = h
            for reg in ["Québec", "Ontario", "Alberta", "Nouvelle-Écosse"] * 6:
                row = table.add_row().cells
                row[0].text = reg
                row[1].text = "12 500"
                row[2].text = "13 750"
                row[3].text = "26 250"
        doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    land = doc.add_section()
    land.orientation = WD_ORIENT.LANDSCAPE
    land.page_width, land.page_height = land.page_height, land.page_width
    doc.add_heading("Annexe en paysage", level=1)
    doc.add_paragraph(LOREM * 4)
    doc.save(out / "rapport.docx")


def docx_long(out: Path) -> None:
    """Environ 300 pages : mesure de l'ouverture et du défilement."""
    doc = Document()
    for chap in range(1, 61):
        doc.add_heading(f"Chapitre {chap}", level=1)
        for _ in range(14):
            doc.add_paragraph(LOREM * 4)
    doc.save(out / "long-300-pages.docx")


def xlsx_budget(out: Path) -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "Budget"
    head = ["Poste", "Janvier", "Février", "Mars", "Total T1"]
    ws.append(head)
    thin = Side(style="thin", color="999999")
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1F4E79")
        c.alignment = Alignment(horizontal="center")
    rows = [("Loyer", 1500, 1500, 1500), ("Salaires", 8200, 8350, 8400),
            ("Logiciels", 320.5, 320.5, 410.75), ("Déplacements", 640, 0, 1210.2),
            ("Formation", 0, 950, 0)]
    for i, (name, a, b, c) in enumerate(rows, start=2):
        ws.append([name, a, b, c, f"=SUM(B{i}:D{i})"])
    last = len(rows) + 1
    ws.append(["Total", f"=SUM(B2:B{last})", f"=SUM(C2:C{last})", f"=SUM(D2:D{last})", f"=SUM(E2:E{last})"])
    for row in ws.iter_rows(min_row=2, max_row=last + 1, min_col=2, max_col=5):
        for c in row:
            c.number_format = '#,##0.00 "$"'
            c.border = Border(top=thin, bottom=thin, left=thin, right=thin)
    for c in ws[last + 1]:
        c.font = Font(bold=True)
    ws.column_dimensions["A"].width = 18
    for col in "BCDE":
        ws.column_dimensions[col].width = 14
    ws["G2"] = "Moyenne mensuelle"
    ws["H2"] = f"=AVERAGE(B{last + 1}:D{last + 1})"
    ws["G3"] = "Plus gros poste"
    ws["H3"] = f'=INDEX(A2:A{last},MATCH(MAX(E2:E{last}),E2:E{last},0))'
    ws["G4"] = "Dépassement ?"
    ws["H4"] = f'=IF(E{last + 1}>30000,"Oui","Non")'
    ws.freeze_panes = "B2"

    chart = BarChart()
    chart.title = "Dépenses du trimestre"
    chart.add_data(Reference(ws, min_col=5, min_row=1, max_row=last), titles_from_data=True)
    chart.set_categories(Reference(ws, min_col=1, min_row=2, max_row=last))
    ws.add_chart(chart, "G7")

    data = wb.create_sheet("Données")
    data.append(["Date", "Client", "Montant", "TPS", "TVQ", "Total"])
    for i in range(2, 502):
        data.append([f"=DATE(2026,{(i % 12) + 1},{(i % 28) + 1})", f"Client {i % 37}", (i * 37) % 1000 + 0.99,
                     f"=C{i}*0.05", f"=C{i}*0.09975", f"=C{i}+D{i}+E{i}"])
    for r in data.iter_rows(min_row=2, min_col=1, max_col=1):
        r[0].number_format = "yyyy-mm-dd"
    wb.create_sheet("Vide")
    wb.save(out / "budget.xlsx")


def pptx_deck(out: Path, img: Path) -> None:
    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
    s = prs.slides.add_slide(prs.slide_layouts[0])
    s.shapes.title.text = "AuxiOffice"
    s.placeholders[1].text = "Présentation de test — fidélité PPTX"

    s = prs.slides.add_slide(prs.slide_layouts[1])
    s.shapes.title.text = "Ordre du jour"
    body = s.placeholders[1].text_frame
    body.text = "Contexte"
    for t, lvl in [("Architecture", 0), ("Moteur LibreOfficeKit", 1), ("Interface maison", 1),
                   ("Feuille de route", 0), ("Questions", 0)]:
        p = body.add_paragraph()
        p.text, p.level = t, lvl

    s = prs.slides.add_slide(prs.slide_layouts[5])
    s.shapes.title.text = "Formes et image"
    colors = [(0x1F, 0x4E, 0x79), (0xF2, 0xA9, 0x00), (0xC0, 0x39, 0x2B)]
    for i, shape in enumerate([MSO_SHAPE.ROUNDED_RECTANGLE, MSO_SHAPE.OVAL, MSO_SHAPE.CHEVRON]):
        sh = s.shapes.add_shape(shape, Inches(0.8 + i * 2.6), Inches(2), Inches(2.2), Inches(1.4))
        sh.fill.solid()
        sh.fill.fore_color.rgb = PptColor(*colors[i])
        sh.text_frame.text = f"Forme {i + 1}"
        sh.text_frame.paragraphs[0].runs[0].font.size = PPt(20)
    s.shapes.add_picture(str(img), Inches(8.6), Inches(1.8), width=Inches(4))

    s = prs.slides.add_slide(prs.slide_layouts[5])
    s.shapes.title.text = "Graphique"
    cd = CategoryChartData()
    cd.categories = ["T1", "T2", "T3", "T4"]
    cd.add_series("2025", (12.5, 14.1, 13.9, 16.0))
    cd.add_series("2026", (13.2, 15.8, 16.4, 18.9))
    s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(1), Inches(1.6), Inches(11), Inches(5.4), cd)

    s = prs.slides.add_slide(prs.slide_layouts[5])
    s.shapes.title.text = "Tableau"
    rows, cols = 5, 4
    t = s.shapes.add_table(rows, cols, Inches(1), Inches(1.8), Inches(11), Inches(4)).table
    for c, h in enumerate(["Produit", "Prix", "Quantité", "Total"]):
        t.cell(0, c).text = h
    for r in range(1, rows):
        for c, v in enumerate([f"Article {r}", f"{r * 9.99:.2f} $", str(r * 3), f"{r * r * 29.97:.2f} $"]):
            t.cell(r, c).text = v
    prs.save(out / "presentation.pptx")


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "fixtures-out")
    out.mkdir(parents=True, exist_ok=True)
    img = make_image(out / "image.png")
    docx_simple(out)
    docx_report(out, img)
    docx_long(out)
    xlsx_budget(out)
    pptx_deck(out, img)
    for f in sorted(out.iterdir()):
        print(f"{f.name}\t{f.stat().st_size}")


if __name__ == "__main__":
    main()
