# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Documents piégés pour l'audit réseau : chacun référence une ressource distante (image liée,
image et feuille de style d'une page HTML) qu'un logiciel respectueux ne doit PAS télécharger
à l'ouverture (pixel espion). Adresses du bloc de documentation TEST-NET-3 (203.0.113.0/24,
RFC 5737) : toute tentative de connexion est identifiable sans ambiguïté.

    from trap_documents import make_trap_documents, TRAP_HOST_PREFIX"""

import zipfile
from pathlib import Path

TRAP_HOST_PREFIX = "203.0.113."

_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_IMAGE_REL = _R + "/image"
_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'


def _zip(path, members):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in members.items():
            z.writestr(name, data)


def _rels(*rels):
    body = "".join(f'<Relationship Id="{i}" Type="{t}" Target="{target}"{extra}/>' for i, t, target, extra in rels)
    return f'{_XML}<Relationships xmlns="{_REL_NS}">{body}</Relationships>'


def _external_image(rid, url):
    return (rid, _IMAGE_REL, url, ' TargetMode="External"')


def make_docx(path, url):
    """Image liée (r:link, relation externe) : téléchargée par le convertisseur d'upstream."""
    blip = (f'<w:p><w:r><w:drawing><wp:inline><wp:extent cx="2000000" cy="2000000"/><wp:docPr id="1" name="img"/>'
            '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="img"/><pic:cNvPicPr/></pic:nvPicPr>'
            '<pic:blipFill><a:blip r:link="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
            '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="2000000"/></a:xfrm>'
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
            '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>')
    document = (f'{_XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
                f'xmlns:r="{_R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
                'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
                'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>'
                '<w:p><w:r><w:t>Document piégé : image liée par URL</w:t></w:r></w:p>' + blip + '</w:body></w:document>')
    _zip(path, {
        "[Content_Types].xml": f'{_XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                               '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                               '<Default Extension="xml" ContentType="application/xml"/>'
                               '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                               '</Types>',
        "_rels/.rels": _rels(("rId1", _R + "/officeDocument", "word/document.xml", "")),
        "word/_rels/document.xml.rels": _rels(_external_image("rIdImg", url)),
        "word/document.xml": document,
    })


def make_odt(path, url):
    content = ('<?xml version="1.0" encoding="UTF-8"?>'
               '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
               'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
               'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" '
               'xmlns:xlink="http://www.w3.org/1999/xlink" '
               'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.2">'
               '<office:body><office:text><text:p>Document piégé : image ODT liée par URL</text:p>'
               '<text:p><draw:frame draw:name="img" svg:width="5cm" svg:height="5cm" text:anchor-type="paragraph">'
               f'<draw:image xlink:href="{url}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>'
               '</draw:frame></text:p></office:text></office:body></office:document-content>')
    manifest = ('<?xml version="1.0" encoding="UTF-8"?>'
                '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">'
                '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>'
                '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'
                '</manifest:manifest>')
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/vnd.oasis.opendocument.text")
        z.writestr("content.xml", content, zipfile.ZIP_DEFLATED)
        z.writestr("META-INF/manifest.xml", manifest, zipfile.ZIP_DEFLATED)


def make_pptx(path, url):
    p_ns = ('xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
            f'xmlns:r="{_R}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"')
    tree = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'
    ct = "application/vnd.openxmlformats-officedocument.presentationml"
    _zip(path, {
        "[Content_Types].xml": f'{_XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                               '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                               '<Default Extension="xml" ContentType="application/xml"/>'
                               f'<Override PartName="/ppt/presentation.xml" ContentType="{ct}.presentation.main+xml"/>'
                               f'<Override PartName="/ppt/slides/slide1.xml" ContentType="{ct}.slide+xml"/>'
                               f'<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="{ct}.slideLayout+xml"/>'
                               f'<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="{ct}.slideMaster+xml"/>'
                               '</Types>',
        "_rels/.rels": _rels(("rId1", _R + "/officeDocument", "ppt/presentation.xml", "")),
        "ppt/presentation.xml": f'{_XML}<p:presentation {p_ns}>'
                                '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdM"/></p:sldMasterIdLst>'
                                '<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>'
                                '<p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>',
        "ppt/_rels/presentation.xml.rels": _rels(("rId1", _R + "/slide", "slides/slide1.xml", ""),
                                                 ("rIdM", _R + "/slideMaster", "slideMasters/slideMaster1.xml", "")),
        "ppt/slides/slide1.xml": f'{_XML}<p:sld {p_ns}><p:cSld><p:spTree>{tree}'
                                 '<p:pic><p:nvPicPr><p:cNvPr id="2" name="img"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>'
                                 '<p:blipFill><a:blip r:link="rIdImg"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
                                 '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3000000" cy="3000000"/></a:xfrm>'
                                 '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'
                                 '</p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping/></p:clrMapOvr></p:sld>',
        "ppt/slides/_rels/slide1.xml.rels": _rels(_external_image("rIdImg", url),
                                                  ("rIdL", _R + "/slideLayout", "../slideLayouts/slideLayout1.xml", "")),
        "ppt/slideMasters/slideMaster1.xml": f'{_XML}<p:sldMaster {p_ns}><p:cSld><p:spTree>{tree}</p:spTree></p:cSld>'
                                             '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" '
                                             'accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" '
                                             'accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
                                             '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rIdL"/></p:sldLayoutIdLst>'
                                             '</p:sldMaster>',
        "ppt/slideMasters/_rels/slideMaster1.xml.rels": _rels(("rIdL", _R + "/slideLayout",
                                                               "../slideLayouts/slideLayout1.xml", "")),
        "ppt/slideLayouts/slideLayout1.xml": f'{_XML}<p:sldLayout {p_ns} type="blank" preserve="1">'
                                             f'<p:cSld name="Blank"><p:spTree>{tree}</p:spTree></p:cSld></p:sldLayout>',
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels": _rels(("rIdM", _R + "/slideMaster",
                                                               "../slideMasters/slideMaster1.xml", "")),
    })


def make_html(path, image_url, css_url):
    Path(path).write_text('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Page piégée</title>'
                          f'<link rel="stylesheet" href="{css_url}"></head><body>'
                          f'<h1>Document piégé : ressources distantes</h1><img src="{image_url}" alt="pixel"></body></html>',
                          encoding="utf-8")


def make_trap_documents(out):
    """Écrit les documents piégés dans out ; renvoie {nom de fichier: adresses référencées}."""
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    base = f"http://{TRAP_HOST_PREFIX}"
    docs = {
        "piege-image-liee.docx": [base + "11/pixel.png"],
        "piege-image.odt": [base + "13/pixel.png"],
        "piege-image-liee.pptx": [base + "18/pixel.png"],
        "piege-page.html": [base + "14/pixel.png", base + "15/style.css"],
    }
    make_docx(out / "piege-image-liee.docx", docs["piege-image-liee.docx"][0])
    make_odt(out / "piege-image.odt", docs["piege-image.odt"][0])
    make_pptx(out / "piege-image-liee.pptx", docs["piege-image-liee.pptx"][0])
    make_html(out / "piege-page.html", *docs["piege-page.html"])
    return docs
