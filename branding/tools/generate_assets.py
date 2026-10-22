#!/usr/bin/env python3
# SPDX-License-Identifier: CC-BY-SA-4.0 OR AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Génère l'identité visuelle d'AuxiOffice à partir de branding/product.json.

Sorties (versionnées dans branding/generated/, régénérables) :
  svg/   sources vectorielles (icônes d'applications, types de fichiers, logo, écran de démarrage)
  png/   rendus aux tailles hicolor (16…512)
  ico/   icônes Windows multi-résolutions
  bmp/   images de l'installateur Windows (NSIS)

Outil de mainteneur : nécessite fontTools, cairosvg et Pillow
    python3 -m pip install fonttools cairosvg pillow
Les lettres sont tirées des contours de Carlito Bold Italic (SIL OFL 1.1, branding/fonts/).
"""

import io
import json
import sys
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

BRANDING = Path(__file__).resolve().parents[1]
OUT = BRANDING / "generated"
PRODUCT = json.loads((BRANDING / "product.json").read_text(encoding="utf-8"))
FONT = TTFont(BRANDING / "fonts" / "Carlito-BoldItalic.ttf")
GLYPHS = FONT.getGlyphSet()
CMAP = FONT.getBestCmap()
UPM = FONT["head"].unitsPerEm

C = PRODUCT["colors"]
ORANGE, AMBER, GRAPHITE, SILVER = C["primary"], C["accent"], C["graphite"], C["silver"]
HICOLOR_SIZES = [16, 22, 24, 32, 48, 64, 128, 256, 512]
ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]


def shade(hex_color, factor):
    """Assombrit (<1) ou éclaircit (>1) une couleur #RRGGBB."""
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
    if factor < 1:
        r, g, b = (int(v * factor) for v in (r, g, b))
    else:
        r, g, b = (int(v + (255 - v) * (factor - 1)) for v in (r, g, b))
    return f"#{r:02X}{g:02X}{b:02X}"


def text_outline(text, size, letter_spacing=0.0):
    """Contours SVG d'un texte (origine : ligne de base à x=0). Renvoie (d, (xmin, ymin, xmax, ymax))."""
    scale = size / UPM
    pen = SVGPathPen(GLYPHS)
    bounds = BoundsPen(GLYPHS)
    x = 0.0
    for ch in text:
        glyph = GLYPHS[CMAP[ord(ch)]]
        t = (scale, 0, 0, -scale, x, 0)
        glyph.draw(TransformPen(pen, t))
        glyph.draw(TransformPen(bounds, t))
        x += glyph.width * scale + letter_spacing * size
    return pen.getCommands(), bounds.bounds


def centered_text(text, size, cx, cy, letter_spacing=0.0):
    d, (x0, y0, x1, y1) = text_outline(text, size, letter_spacing)
    dx = cx - (x0 + x1) / 2
    dy = cy - (y0 + y1) / 2
    return f'<path transform="translate({dx:.2f} {dy:.2f})" d="{d}"/>'


def svg_doc(w, h, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">\n'
            f'{body}\n</svg>\n')


def app_icon(letter, base, main=False):
    """Icône d'application : carré arrondi, lettre en italique grasse, soulignement orange
    (repris du logo AuxiNux)."""
    if main:
        bg_from, bg_to = "#3A3D44", GRAPHITE
        glyph_fill = "url(#glyph)"
        size = 200
    else:
        bg_from, bg_to = shade(base, 1.18), shade(base, 0.78)
        glyph_fill = "#FFFFFF"
        size = 170 if len(letter) == 1 else 92
    glyph = centered_text(letter, size, 128, 116 if len(letter) == 1 else 118)
    underline_y = 192 if len(letter) == 1 else 172
    body = f'''  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{bg_from}"/><stop offset="1" stop-color="{bg_to}"/>
    </linearGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.22"/><stop offset="0.55" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="glyph" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{AMBER}"/><stop offset="1" stop-color="{ORANGE}"/>
    </linearGradient>
    <linearGradient id="swoosh" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="{ORANGE}"/><stop offset="1" stop-color="{AMBER}"/>
    </linearGradient>
  </defs>
  <rect x="12" y="12" width="232" height="232" rx="54" fill="url(#bg)"/>
  <rect x="12" y="12" width="232" height="232" rx="54" fill="url(#gloss)"/>
  <g fill="#000000" fill-opacity="0.28" transform="translate(3 6)">{glyph}</g>
  {('<g fill="none" stroke="#141518" stroke-width="10" stroke-linejoin="round">' + glyph + '</g>') if main else ''}
  <g fill="{glyph_fill}">{glyph}</g>
  <rect x="70" y="{underline_y}" width="122" height="13" rx="6.5" transform="skewX(-12) translate({underline_y * 0.212:.1f} 0)" fill="url(#swoosh)"/>'''
    return svg_doc(256, 256, body)


def mime_icon(label, base):
    """Icône de type de fichier : feuille à coin plié + pastille colorée."""
    badge = centered_text(label, 64 if len(label) == 1 else 44, 108, 160)
    body = f'''  <defs>
    <linearGradient id="badge" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{shade(base, 1.15)}"/><stop offset="1" stop-color="{shade(base, 0.8)}"/>
    </linearGradient>
  </defs>
  <path d="M56 14 H166 L216 64 V242 H56 Z" fill="#FFFFFF" stroke="#BFC3C8" stroke-width="4" stroke-linejoin="round"/>
  <path d="M166 14 V64 H216 Z" fill="#E4E6E9" stroke="#BFC3C8" stroke-width="4" stroke-linejoin="round"/>
  <g fill="#D5D8DC">
    <rect x="80" y="74" width="72" height="10" rx="5"/>
    <rect x="80" y="96" width="112" height="10" rx="5"/>
    <rect x="80" y="210" width="112" height="10" rx="5"/>
  </g>
  <rect x="40" y="124" width="136" height="76" rx="14" fill="url(#badge)"/>
  <rect x="40" y="194" width="136" height="6" rx="3" fill="{ORANGE}"/>
  <g fill="#FFFFFF">{badge}</g>'''
    return svg_doc(256, 256, body)


def wordmark(dark=False):
    """Logo horizontal « AuxiOffice » (Auxi orange, Office argent, contour sombre)."""
    size = 120
    auxi, (a0, ay0, a1, ay1) = text_outline("Auxi", size)
    office, (o0, oy0, o1, oy1) = text_outline("Office", size)
    gap = size * 0.06
    office_dx = a1 + gap - o0
    width = office_dx + o1 + 24
    top = min(ay0, oy0)
    bottom = max(ay1, oy1)
    height = bottom - top + 48
    base_y = -top + 22
    outline = "#0E0F11" if not dark else "#000000"
    body = f'''  <defs>
    <linearGradient id="auxi" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{AMBER}"/><stop offset="0.55" stop-color="{ORANGE}"/><stop offset="1" stop-color="{shade(ORANGE, 0.85)}"/>
    </linearGradient>
    <linearGradient id="office" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F4F5F5"/><stop offset="0.55" stop-color="{SILVER}"/><stop offset="1" stop-color="#8E9193"/>
    </linearGradient>
    <linearGradient id="swoosh" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="{ORANGE}" stop-opacity="0"/><stop offset="0.25" stop-color="{ORANGE}"/>
      <stop offset="0.75" stop-color="{AMBER}"/><stop offset="1" stop-color="{AMBER}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <g transform="translate(12 {base_y:.1f})">
    <g stroke="{outline}" stroke-width="7" stroke-linejoin="round" fill="none">
      <path d="{auxi}"/><path transform="translate({office_dx:.1f} 0)" d="{office}"/>
    </g>
    <path fill="url(#auxi)" d="{auxi}"/>
    <path fill="url(#office)" transform="translate({office_dx:.1f} 0)" d="{office}"/>
    <rect x="{a0 + 10:.1f}" y="{oy1 + 10:.1f}" width="{office_dx + o1 - a0 - 20:.1f}" height="5" rx="2.5" fill="url(#swoosh)"/>
  </g>'''
    return svg_doc(int(width + 24), int(height), body)


def text_page_icon(dark):
    """Grande icône « fichier texte » de la page d'accueil (108x100, comme docx-big upstream)."""
    page = "#2D2D2D" if dark else "#FFFFFF"
    line = "#4A4F57" if dark else "#CDD1D6"
    widths = [58, 44, 52, 30, 58, 40, 22]
    rects = "".join(f'<rect x="24" y="{10 + i * 12}" width="{w}" height="6" rx="1" fill="{line}"/>' for i, w in enumerate(widths))
    return svg_doc(108, 100, f'''  <path fill="{page}" d="M14 4a4 4 0 0 1 4-4h72a4 4 0 0 1 4 4v92a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V4Z"/>
  {rects}''')


def splash():
    """Écran de démarrage / bannière (installateur, AppImage, documentation)."""
    mark = wordmark(dark=True)
    inner = mark.split("\n", 1)[1].rsplit("</svg>", 1)[0]
    mw = int(mark.split('width="', 1)[1].split('"', 1)[0])
    mh = int(mark.split('height="', 1)[1].split('"', 1)[0])
    scale = 560 / mw
    version = PRODUCT_VERSION
    tagline, _ = text_outline("Suite bureautique AuxiNux", 30)
    vpath, _ = text_outline(f"Version {version}", 24)
    body = f'''  <defs>
    <linearGradient id="splashbg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2E3036"/><stop offset="1" stop-color="#17181B"/>
    </linearGradient>
  </defs>
  <rect width="720" height="400" fill="url(#splashbg)"/>
  <rect y="392" width="720" height="8" fill="{ORANGE}"/>
  <g transform="translate(80 {200 - mh * scale / 2 - 30:.1f}) scale({scale:.4f})">{inner}</g>
  <path fill="#C9CBCE" transform="translate(84 300)" d="{tagline}"/>
  <path fill="{AMBER}" transform="translate(84 340)" d="{vpath}"/>'''
    return svg_doc(720, 400, body)


def render_png(svg_text, size, out):
    import cairosvg
    out.parent.mkdir(parents=True, exist_ok=True)
    cairosvg.svg2png(bytestring=svg_text.encode(), write_to=str(out), output_width=size, output_height=size)


def render_png_wh(svg_text, width, height, out):
    import cairosvg
    out.parent.mkdir(parents=True, exist_ok=True)
    cairosvg.svg2png(bytestring=svg_text.encode(), write_to=str(out), output_width=width, output_height=height)


def write_ico(svg_text, out):
    import cairosvg
    from PIL import Image
    images = []
    for s in ICO_SIZES:
        png = cairosvg.svg2png(bytestring=svg_text.encode(), output_width=s, output_height=s)
        images.append(Image.open(io.BytesIO(png)).convert("RGBA"))
    out.parent.mkdir(parents=True, exist_ok=True)
    images[-1].save(out, format="ICO", sizes=[(s, s) for s in ICO_SIZES], append_images=images[:-1])


def write_bmp(svg_text, width, height, out, background="#FFFFFF"):
    import cairosvg
    from PIL import Image
    png = cairosvg.svg2png(bytestring=svg_text.encode(), output_width=width, output_height=height)
    img = Image.open(io.BytesIO(png)).convert("RGBA")
    flat = Image.new("RGB", img.size, background)
    flat.paste(img, mask=img.split()[3])
    out.parent.mkdir(parents=True, exist_ok=True)
    flat.save(out, format="BMP")


PRODUCT_VERSION = (BRANDING.parent / "VERSION").read_text().strip()


def _inner(svg):
    """Contenu d'un document SVG sans la balise racine."""
    return svg.split("\n", 1)[1].rsplit("</svg>", 1)[0]


def _size(svg):
    w = float(svg.split('width="', 1)[1].split('"', 1)[0])
    h = float(svg.split('height="', 1)[1].split('"', 1)[0])
    return w, h


def _scoped(svg, prefix):
    """Préfixe les identifiants internes (dégradés) pour combiner plusieurs SVG."""
    for ident in ("bg", "gloss", "glyph", "swoosh", "badge", "auxi", "nux"):
        svg = svg.replace(f'id="{ident}"', f'id="{prefix}-{ident}"').replace(f"url(#{ident})", f"url(#{prefix}-{ident})")
    return svg


def welcome_illustration(dark, icons):
    """Illustration de l'écran d'accueil (377x193) : les cinq applications de la suite."""
    order = ["auxiwriter", "auxisheet", "auxipresent", "auxipdf", "auxitext"]
    ground = "#2A2C31" if dark else "#E9E9E6"
    parts = [f'  <ellipse cx="188.5" cy="166" rx="176" ry="15" fill="{ground}"/>']
    positions = [(8, 84, 0.27), (80, 64, 0.29), (146, 42, 0.33), (222, 64, 0.29), (300, 84, 0.27)]
    for name, (x, y, sc) in zip(order, positions):
        parts.append(f'  <g transform="translate({x} {y}) scale({sc})">{_inner(_scoped(icons[name], name))}</g>')
    parts.append(f'  <rect x="128" y="176" width="121" height="6" rx="3" fill="{ORANGE}"/>')
    return svg_doc(377, 193, "\n".join(parts))


def shell_logo(dark):
    """Logo compact de la barre d'onglets du shell (85x20, comme upstream)."""
    mark = wordmark(dark)
    w, h = _size(mark)
    scale = min(83 / w, 18 / h)
    dx = (85 - w * scale) / 2
    dy = (20 - h * scale) / 2
    return svg_doc(85, 20, f'  <g transform="translate({dx:.2f} {dy:.2f}) scale({scale:.5f})">{_inner(mark)}</g>')


def main():
    apps = PRODUCT["apps"]
    icons = {
        "auxioffice": app_icon("A", ORANGE, main=True),
        "auxiwriter": app_icon(apps["writer"]["letter"], apps["writer"]["color"]),
        "auxisheet": app_icon(apps["sheet"]["letter"], apps["sheet"]["color"]),
        "auxipresent": app_icon(apps["present"]["letter"], apps["present"]["color"]),
        "auxidraw": app_icon(apps["draw"]["letter"], apps["draw"]["color"]),
        "auxipdf": app_icon("PDF", apps["pdf"]["color"]),
        "auxitext": app_icon(apps["text"]["letter"], apps["text"]["color"]),
        "auximail": app_icon(apps["mail"]["letter"], apps["mail"]["color"]),
    }
    mimes = {
        "document": mime_icon(apps["writer"]["letter"], apps["writer"]["color"]),
        "spreadsheet": mime_icon(apps["sheet"]["letter"], apps["sheet"]["color"]),
        "presentation": mime_icon(apps["present"]["letter"], apps["present"]["color"]),
        "drawing": mime_icon(apps["draw"]["letter"], apps["draw"]["color"]),
        "pdf": mime_icon("PDF", apps["pdf"]["color"]),
        "text": mime_icon("TXT", apps["text"]["color"]),
    }
    svg_dir = OUT / "svg"
    svg_dir.mkdir(parents=True, exist_ok=True)
    for name, svg in {**icons, **{f"mime-{k}": v for k, v in mimes.items()}}.items():
        (svg_dir / f"{name}.svg").write_text(svg, encoding="utf-8")
        for s in HICOLOR_SIZES:
            render_png(svg, s, OUT / "png" / f"{s}x{s}" / f"{name}.png")
        write_ico(svg, OUT / "ico" / f"{name}.ico")
    for variant, dark in (("logo-light", False), ("logo-dark", True)):
        svg = wordmark(dark)
        (svg_dir / f"{variant}.svg").write_text(svg, encoding="utf-8")
        w = int(svg.split('width="', 1)[1].split('"', 1)[0])
        h = int(svg.split('height="', 1)[1].split('"', 1)[0])
        render_png_wh(svg, 600, int(600 * h / w), OUT / "png" / f"{variant}.png")
    for variant, dark in (("welcome-light", False), ("welcome-dark", True)):
        svg = welcome_illustration(dark, icons)
        (svg_dir / f"{variant}.svg").write_text(svg, encoding="utf-8")
        render_png_wh(svg, 754, 386, OUT / "png" / f"{variant}.png")
    for variant, dark in (("shell-logo-light", False), ("shell-logo-dark", True)):
        svg = shell_logo(dark)
        (svg_dir / f"{variant}.svg").write_text(svg, encoding="utf-8")
        for factor, suffix in ((1, ""), (1.25, "@1.25x"), (1.5, "@1.5x"), (1.75, "@1.75x"), (2, "@2x")):
            render_png_wh(svg, round(85 * factor), round(20 * factor), OUT / "png" / f"{variant}{suffix}.png")
    for variant, dark in (("txt-big", False), ("txt-big-dark", True)):
        (svg_dir / f"{variant}.svg").write_text(text_page_icon(dark), encoding="utf-8")
    sp = splash()
    (svg_dir / "splash.svg").write_text(sp, encoding="utf-8")
    render_png_wh(sp, 720, 400, OUT / "png" / "splash.png")
    # Images NSIS : en-tête 150x57 et panneau d'accueil 164x314
    header = svg_doc(150, 57, '  <rect width="150" height="57" fill="#FFFFFF"/>' + "\n"
                     + f'  <g transform="translate(97 5) scale(0.184)">{icons["auxioffice"].split(chr(10), 1)[1].rsplit("</svg>", 1)[0]}</g>')
    write_bmp(header, 150, 57, OUT / "bmp" / "nsis-header.bmp")
    welcome_icon = icons["auxioffice"].split("\n", 1)[1].rsplit("</svg>", 1)[0]
    welcome = svg_doc(164, 314, f'''  <defs><linearGradient id="wbg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2E3036"/><stop offset="1" stop-color="#17181B"/></linearGradient></defs>
  <rect width="164" height="314" fill="url(#wbg)"/>
  <rect x="0" y="306" width="164" height="8" fill="{ORANGE}"/>
  <g transform="translate(26 40) scale(0.4375)">{welcome_icon}</g>''')
    write_bmp(welcome, 164, 314, OUT / "bmp" / "nsis-welcome.bmp", background="#17181B")
    print(f"Ressources générées dans {OUT}")


if __name__ == "__main__":
    sys.exit(main())
