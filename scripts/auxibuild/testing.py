# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Projet AuxiNux
"""Automated tests of an assembled AuxiNux Office tree.

Linux : versions, AuxiText unit tests, static branding/privacy/legal checks,
        GUI smoke tests (Xvfb + xdotool, offline) with a network audit (strace),
        engine conversion tests (x2t: DOCX/XLSX/PPTX -> PDF/ODF and back).
Windows (cross-built from Linux): static checks (PE imports, version resources,
        subsystem) and, when AUXI_WINE points to a Wine launcher, a smoke test under
        Wine (versions, shell start-up through the launcher). Wine is not Windows: the
        functional tests remain manual (docs/TESTING-WINDOWS.md).

A Markdown + JSON report is written to build/test-reports/<target>/. Any failure
makes the stage fail: untested artefacts are never reported as validated."""

import json
import os
import shutil
import subprocess
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from .common import BUILD_DIR, ROOT, fail, info, ok, product, rmtree, run, step, version, warn, write_text
from .assemble import stage_dir

REPORTS = BUILD_DIR / "test-reports"
FIXTURES = BUILD_DIR / "test-fixtures"

# Codes de format x2t (core/Common/OfficeFileFormats.h)
FMT = {"docx": 65, "odt": 67, "rtf": 68, "txt": 69, "pptx": 129, "odp": 131, "xlsx": 257, "ods": 259, "csv": 260,
       "pdf": 513}


class Report:
    def __init__(self, target):
        self.target = target
        self.items = []

    def add(self, name, ok_, detail="", skipped=False):
        status = "IGNORÉ" if skipped else ("OK" if ok_ else "ÉCHEC")
        self.items.append({"test": name, "status": status, "detail": detail})
        (warn if skipped else ok if ok_ else warn)(f"{status} — {name} {detail}".strip())

    @property
    def failures(self):
        return [i for i in self.items if i["status"] == "ÉCHEC"]

    def write(self):
        out = REPORTS / self.target
        out.mkdir(parents=True, exist_ok=True)
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        lines = [f"# Rapport de tests — AuxiNux Office {version()} ({self.target})", "", f"Généré le {now}.", "",
                 "| Test | Résultat | Détail |", "|---|---|---|"]
        for i in self.items:
            lines.append(f"| {i['test']} | {i['status']} | {i['detail'].replace('|', '/')} |")
        lines += ["", f"**{len(self.items) - len(self.failures)} / {len(self.items)}** réussis ou ignorés, "
                      f"{len(self.failures)} échec(s)."]
        write_text(out / "report.md", "\n".join(lines) + "\n")
        write_text(out / "report.json", json.dumps(self.items, ensure_ascii=False, indent=2))
        info(f"rapport : {out / 'report.md'}")


def _tool(env_name, default):
    value = os.environ.get(env_name, default)
    return value if (value and (shutil.which(value.split()[0]) or Path(value.split()[0]).exists())) else None


# ---------------------------------------------------------------------------
# Linux
# ---------------------------------------------------------------------------

def test_versions(r, stage):
    expected = f"{product()['product']['name']} {version()}"
    for binary, want in (("auxioffice", expected), ("auxitext", f"AuxiText {version()} (AuxiNux Office)")):
        res = subprocess.run([stage / binary, "--version"], capture_output=True, text=True, timeout=30)
        r.add(f"{binary} --version", res.stdout.strip() == want, repr(res.stdout.strip()))
    env = dict(os.environ, LD_LIBRARY_PATH=str(stage))
    res = subprocess.run([stage / "auxioffice-editors", "--version"], capture_output=True, text=True, env=env, timeout=30)
    r.add("auxioffice-editors --version", res.stdout.strip() == expected, repr(res.stdout.strip()))


def test_auxitext_unit(r):
    from .toolchain import ensure_qt
    qt = ensure_qt("qt_linux")
    out = BUILD_DIR / "native" / "linux" / "tests"
    out.mkdir(parents=True, exist_ok=True)
    run([qt / "bin" / "qmake", ROOT / "tests" / "auxitext" / "tst_textio.pro"], cwd=out, quiet=True,
        log_file=out / "qmake.log")
    run(["make", "-j4"], cwd=out, log_file=out / "make.log")
    res = subprocess.run([out / "tst_textio"], capture_output=True, text=True,
                         env=dict(os.environ, LD_LIBRARY_PATH=str(qt / "lib")), timeout=120)
    summary = [l for l in res.stdout.splitlines() if l.startswith("Totals")]
    r.add("AuxiText : tests unitaires (encodages, fins de ligne)", res.returncode == 0, summary[0] if summary else "")


def test_static(r, stage, target):
    removed = product()["privacy"]["removed_plugins"]
    plugins = stage / "editors" / "sdkjs-plugins"
    present = [label for guid, label in removed.items() if (plugins / guid).exists()]
    r.add("plugins réseau retirés", not present, ", ".join(present) or f"{len(removed)} absents")
    for f in ("LICENSE.txt", "NOTICE.txt", "licenses/index.html", "licenses/ONLYOFFICE-LICENSE.txt",
              "licenses/3DPARTY-desktop.txt", "licenses/AGPL-3.0.txt"):
        r.add(f"fichier légal {f}", (stage / f).exists())
    notice = (stage / "NOTICE.txt").read_text(encoding="utf-8")
    r.add("NOTICE : attribution et date de modification",
          "Ascensio System SIA" in notice and "2026-10-01" in notice and "n'est pas un produit officiel" in notice)
    home = (stage / "index.html").read_text(encoding="utf-8", errors="ignore")
    r.add("page d'accueil : module AuxiNux", "AUXINUX_BRANDING" in home and "Bienvenue dans" in home)
    if target == "linux":
        r.add("service de mise à jour upstream absent", not (stage / "DesktopEditors").exists())
    else:
        r.add("service de mise à jour upstream absent", not (stage / "updatesvc.exe").exists())
    test_no_upstream_logo(r, stage)


# Débuts des tracés des logos ONLYOFFICE (en-tête 85×20 et À propos 245×45), tels qu'écrits dans
# les sources et après optimisation des SVG par le build de web-apps.
UPSTREAM_LOGO_SIGNATURES = ("M20.211 7.003", "M64.7249 13.8022", "M64.725 13.802")


def test_no_upstream_logo(r, stage):
    """Identité visuelle : aucun logo ONLYOFFICE dans l'interface livrée (SVG, CSS dont les
    images intégrées encodées, HTML, JS) ; icônes d'onglet des éditeurs aux couleurs AuxiNux."""
    signatures = UPSTREAM_LOGO_SIGNATURES + tuple(sig.replace(" ", "%20") for sig in UPSTREAM_LOGO_SIGNATURES)
    found = []
    files = [stage / "index.html", *(stage / "editors" / "web-apps").rglob("*")]
    for f in files:
        if f.is_file() and f.suffix in (".svg", ".css", ".html", ".js"):
            text = f.read_text(encoding="utf-8", errors="ignore")
            if any(sig in text for sig in signatures):
                found.append(str(f.relative_to(stage)))
    r.add("aucun logo ONLYOFFICE dans l'interface", not found, ", ".join(found[:4]) or "logos AuxiNux")
    from .branding_editors import EDITOR_FAVICONS, GEN
    apps = stage / "editors" / "web-apps" / "apps"
    wrong = [folder for folder, icon in EDITOR_FAVICONS.items()
             if (apps / folder / "main" / "resources" / "img" / "favicon.ico").exists()
             and (apps / folder / "main" / "resources" / "img" / "favicon.ico").read_bytes()
             != (GEN / "ico" / f"{icon}.ico").read_bytes()]
    r.add("icônes d'onglet des éditeurs AuxiNux", not wrong, ", ".join(wrong) or "favicon AuxiNux")


def test_gui(r, stage, py):
    xvfb = _tool("AUXI_XVFB", "Xvfb")
    xdotool = _tool("AUXI_XDOTOOL", "xdotool")
    strace = _tool("AUXI_STRACE", "strace")
    if not (xvfb and xdotool):
        r.add("tests graphiques (Xvfb/xdotool)", False, "Xvfb ou xdotool absents (AUXI_XVFB / AUXI_XDOTOOL)",
              skipped=True)
        return False
    out = REPORTS / "linux" / "gui"
    rmtree(out)
    cmd = [py, ROOT / "tests" / "smoke" / "linux_gui_smoke.py", "--app", stage, "--fixtures", FIXTURES,
           "--out", out, "--xvfb", xvfb, "--xdotool", xdotool]
    if strace:
        cmd += ["--network-audit", strace]
    subprocess.run(cmd, timeout=2400)
    result = json.loads((out / "gui-smoke.json").read_text()) if (out / "gui-smoke.json").exists() else {"results": []}
    for item in result["results"]:
        r.add(f"[GUI] {item['test']}", item["ok"], item.get("detail", ""))
    if not strace:
        r.add("[GUI] audit réseau", False, "strace absent", skipped=True)
    r.add("[GUI] exécuté sans réseau (namespace isolé)", result.get("offline_namespace", False),
          "unshare -Un" if result.get("offline_namespace") else "namespaces indisponibles : réseau non isolé")
    return True


def _no_core_dumps():
    import resource
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def _x2t(stage, src, dst, fmt, fonts, tmp):
    # CSV : encodage UTF-8 (46) et séparateur point-virgule (2), choisis dans l'application par un dialogue
    csv = "<m_nCsvTxtEncoding>46</m_nCsvTxtEncoding><m_nCsvDelimiter>2</m_nCsvDelimiter>" \
        if str(src).endswith(".csv") else ""
    params = f"""<?xml version="1.0" encoding="utf-8"?><TaskQueueDataConvert>{csv}
<m_sFileFrom>{src}</m_sFileFrom><m_sFileTo>{dst}</m_sFileTo><m_nFormatTo>{fmt}</m_nFormatTo>
<m_sFontDir>{fonts}</m_sFontDir><m_sAllFontsPath>{fonts}/AllFonts.js</m_sAllFontsPath>
<m_sThemeDir>{stage}/editors/sdkjs/slide/themes</m_sThemeDir><m_sTempDir>{tmp}</m_sTempDir>
<m_bIsNoBase64>false</m_bIsNoBase64></TaskQueueDataConvert>"""
    xml = tmp / f"params-{Path(dst).name}.xml"
    write_text(xml, params)
    env = dict(os.environ, LD_LIBRARY_PATH=str(stage / "converter"), APPLICATION_NAME="AuxiNux Office", COMPANY_NAME="")
    # Répertoire courant temporaire et vidages mémoire désactivés : rien n'est écrit dans l'arbre testé.
    res = subprocess.run([stage / "converter" / "x2t", xml], cwd=tmp, env=env, capture_output=True, text=True,
                         timeout=300, preexec_fn=_no_core_dumps)
    return res.returncode, (res.stdout + res.stderr)[-300:]


def _pdf_text(py, pdf):
    res = subprocess.run([py, "-c", "import sys; from pypdf import PdfReader; "
                          "print(''.join(p.extract_text() or '' for p in PdfReader(sys.argv[1]).pages))", pdf],
                         capture_output=True, text=True)
    return res.stdout


def test_engine(r, stage, py):
    """Conversions réelles par le moteur livré (x2t), avec le cache de polices de la session GUI."""
    fonts = REPORTS / "linux" / "gui" / "home" / ".local/share/auxioffice/data/fonts"
    if not (fonts / "AllFonts.js").exists():
        r.add("conversions x2t", False, "cache des polices absent (tests graphiques non exécutés)", skipped=True)
        return
    out = REPORTS / "linux" / "conversions"
    rmtree(out)
    tmp = out / "tmp"
    tmp.mkdir(parents=True)
    cases = [("rapport.docx", "pdf", "AuxiNux-Test-7Q2"), ("budget.xlsx", "pdf", "AuxiNux-Test-7Q2"),
             ("presentation.pptx", "pdf", "AuxiNux-Test-7Q2"), ("rapport.docx", "odt", None),
             ("budget.xlsx", "ods", None), ("presentation.pptx", "odp", None), ("tableau.csv", "xlsx", None),
             ("rapport.docx", "rtf", None), ("rapport.docx", "txt", "AuxiNux-Test-7Q2")]
    for name, fmt, marker in cases:
        src = FIXTURES / name
        dst = out / f"{Path(name).stem}-{Path(name).suffix[1:]}.{fmt}"
        rc, log = _x2t(stage, src, dst, FMT[fmt], fonts, tmp)
        good = rc == 0 and dst.exists() and dst.stat().st_size > 0
        detail = f"{dst.name} ({dst.stat().st_size if dst.exists() else 0} o)"
        if good and fmt == "pdf" and marker:
            good = marker in _pdf_text(py, dst)
            detail += ", texte retrouvé dans le PDF" if good else ", texte introuvable dans le PDF"
        if good and Path(name).suffix == ".csv":
            book = zipfile.ZipFile(dst)
            from_csv = "".join(book.read(n).decode("utf-8") for n in book.namelist()
                               if n.startswith("xl/") and n.endswith(".xml"))
            good = "alpha" in from_csv and "beta" in from_csv
            detail += ", cellules alpha/beta retrouvées" if good else ", contenu CSV absent"
        if good and fmt == "txt" and marker:
            good = marker in dst.read_text(encoding="utf-8", errors="ignore")
        r.add(f"x2t {Path(name).suffix[1:].upper()} -> {fmt.upper()}", good, detail if good else f"code {rc} {log}")
    # Aller-retour ODT -> DOCX : le format OpenDocument est relu
    odt = out / "rapport-docx.odt"
    if odt.exists():
        back = out / "rapport-odt.docx"
        rc, log = _x2t(stage, odt, back, FMT["docx"], fonts, tmp)
        good = rc == 0 and back.exists() and "AuxiNux-Test-7Q2" in zipfile.ZipFile(back).read("word/document.xml").decode()
        r.add("x2t ODT -> DOCX (aller-retour)", good, back.name if good else f"code {rc} {log}")


# ---------------------------------------------------------------------------
# Windows (vérifications statiques depuis Linux)
# ---------------------------------------------------------------------------

def test_windows_static(r, stage):
    from .toolchain import ensure_venv
    py = ensure_venv()
    # Dossiers de recherche des DLL à l'exécution : le dossier de l'application ; le shell
    # reçoit en plus converter\ dans son PATH (lanceur auxioffice.exe, comme upstream).
    search = {"auxioffice.exe": [stage], "auxitext.exe": [stage],
              "auxioffice-editors.exe": [stage, stage / "converter"]}
    for exe, dirs in search.items():
        res = subprocess.run([py, ROOT / "scripts" / "tools" / "check_pe_imports.py", stage / exe, *dirs],
                             capture_output=True, text=True)
        out = (res.stdout.strip().splitlines() or [res.stderr.strip()])[-1]
        r.add(f"{exe} : imports résolus par les DLL livrées", res.returncode == 0, out[:160])
    script = (
        "import pefile,sys\n"
        "pe=pefile.PE(sys.argv[1])\n"
        "info={}\n"
        "for fi in getattr(pe,'FileInfo',[]):\n"
        "  for e in fi:\n"
        "    for st in getattr(e,'StringTable',[]):\n"
        "      info.update({k.decode():v.decode() for k,v in st.entries.items()})\n"
        "print(pe.OPTIONAL_HEADER.Subsystem, info.get('ProductName',''), info.get('ProductVersion',''))\n")
    for exe in ("auxioffice.exe", "auxioffice-editors.exe", "auxitext.exe"):
        res = subprocess.run([py, "-c", script, stage / exe], capture_output=True, text=True)
        parts = res.stdout.strip().split(" ", 1)
        r.add(f"{exe} : sous-système GUI et métadonnées", res.returncode == 0 and parts[0] == "2"
              and "AuxiNux Office" in res.stdout, res.stdout.strip()[:120])
    r.add("tests fonctionnels Windows", False, "à exécuter sur Windows 10/11 (docs/TESTING-WINDOWS.md)", skipped=True)


def test_windows_wine(r, stage):
    """Facultatif : AUXI_WINE = lanceur Wine (avec son WINEPREFIX). Vérifie les versions et que le
    shell démarre via le lanceur, avec toutes ses DLL (moteur dans converter\\) et ses processus CEF."""
    wine = os.environ.get("AUXI_WINE")
    if not wine:
        r.add("tests sous Wine", False, "AUXI_WINE non défini (facultatif, voir docs/TESTING-WINDOWS.md)",
              skipped=True)
        return
    env = dict(os.environ, WINEDEBUG="err+module")
    expected = f"{product()['product']['name']} {version()}"
    res = subprocess.run([wine, stage / "auxioffice.exe", "--version"], capture_output=True, text=True,
                         env=env, timeout=120)
    r.add("Wine : auxioffice.exe --version", res.stdout.strip() == expected, res.stdout.strip()[:80])
    res = subprocess.run([wine, stage / "auxitext.exe", "--version"], capture_output=True, text=True,
                         env=env, timeout=120)
    r.add("Wine : auxitext.exe --version", res.stdout.startswith(f"AuxiText {version()}"), res.stdout.strip()[:80])

    log = REPORTS / "windows" / "wine-shell.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    with open(log, "w", encoding="utf-8", errors="replace") as fh:
        proc = subprocess.Popen([wine, stage / "auxioffice.exe"], stdout=fh, stderr=subprocess.STDOUT, env=env)
        running = False
        for _ in range(60):
            time.sleep(2)
            ps = subprocess.run(["ps", "-eo", "args"], capture_output=True, text=True).stdout
            if "auxioffice-editors.exe" in ps and "editors_helper.exe" in ps:
                running = True
                time.sleep(10)
                break
        subprocess.run([wine, "wineboot", "--end-session"], capture_output=True, env=env, timeout=120)
        server = os.environ.get("AUXI_WINESERVER") or shutil.which("wineserver")
        if server:
            subprocess.run([server, "-k"], capture_output=True, timeout=60)
        try:
            proc.wait(timeout=60)
        except subprocess.TimeoutExpired:
            proc.kill()
    text = log.read_text(encoding="utf-8", errors="replace")
    missing = sorted({l.split("Library ")[1].split(" ")[0] for l in text.splitlines()
                      if "import_dll" in l and "Library " in l})
    r.add("Wine : shell lancé via auxioffice.exe (DLL du moteur et processus CEF)", running and not missing,
          ("DLL introuvables : " + ", ".join(missing)) if missing else ("démarré" if running else "non démarré"))


def run_all(args):
    step(f"Tests ({args.target})")
    stage = stage_dir(args.target)
    if not stage.exists():
        fail("arbre d'installation absent : lancer l'étape assemble")
    r = Report(args.target)
    test_static(r, stage, args.target)
    if args.target == "linux":
        from .toolchain import ensure_test_venv
        py = ensure_test_venv()
        rmtree(FIXTURES)
        run([py, ROOT / "tests" / "fixtures" / "make_fixtures.py", FIXTURES], quiet=True)
        test_versions(r, stage)
        test_auxitext_unit(r)
        if test_gui(r, stage, py):
            test_engine(r, stage, py)
    else:
        test_windows_static(r, stage)
        test_windows_wine(r, stage)
    r.write()
    if r.failures:
        fail(f"{len(r.failures)} test(s) en échec — voir {REPORTS / args.target / 'report.md'}")
    ok("tous les tests exécutés ont réussi")
